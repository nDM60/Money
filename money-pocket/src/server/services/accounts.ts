import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db";
import { ACCOUNT_TYPES, CASH_TYPES, LIABILITY_TYPES, type AccountType } from "@/lib/domain";
import { CURRENCY_CODES } from "@/lib/money";
import { isDateStr } from "@/lib/dates";
import { HttpError, notFound, badRequest } from "../http";
import { audit, markSyncDirty, type Exec } from "./common";
import { getSettings, userToday } from "./settings";
import { createTransaction } from "./transactions";

export type Account = typeof schema.accounts.$inferSelect;
export type AccountWithBalance = Account & { balance: number };

const dateStr = z.string().refine(isDateStr, "invalid date");

export const accountInput = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(80).nullish(),
  icon: z.string().max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  /** Minor units. Existing money — recorded as an opening balance, never as income. */
  openingBalance: z.number().int().refine(Number.isSafeInteger),
  openingDate: dateStr.optional(),
  notes: z.string().max(1000).nullish(),
});

export const accountPatch = accountInput.partial().extend({
  status: z.enum(["active", "archived"]).optional(),
  sortOrder: z.number().int().optional(),
});

/**
 * Balance of each account: opening balance + all movements dated on/after the
 * opening date (and on/before `asOf`, when given). Movements dated before the
 * opening date are already reflected in the opening balance.
 */
export async function accountBalances(db: Exec, userId: string, asOf?: string): Promise<Map<string, number>> {
  const a = schema.accounts;
  const t = schema.transactions;
  const asOfCond = asOf ? sql`and ${t.localDate} <= ${asOf}` : sql``;
  const rows = await db
    .select({
      id: a.id,
      opening: a.openingBalance,
      openingDate: a.openingDate,
      inflow: sql<string>`coalesce(sum(case when ${t.toAccountId} = ${a.id} then ${t.toAmount} else 0 end), 0)`,
      outflow: sql<string>`coalesce(sum(case when ${t.fromAccountId} = ${a.id} then ${t.fromAmount} else 0 end), 0)`,
    })
    .from(a)
    .leftJoin(t, sql`${t.userId} = ${a.userId} and ${t.deletedAt} is null and (${t.toAccountId} = ${a.id} or ${t.fromAccountId} = ${a.id}) and ${t.localDate} >= ${a.openingDate} ${asOfCond}`)
    .where(eq(a.userId, userId))
    .groupBy(a.id);
  const m = new Map<string, number>();
  for (const r of rows) {
    if (asOf && r.openingDate > asOf) {
      m.set(r.id, 0);
      continue;
    }
    m.set(r.id, Number(r.opening) + Number(r.inflow) - Number(r.outflow));
  }
  return m;
}

export async function listAccounts(db: Exec, userId: string, opts: { includeArchived?: boolean } = {}): Promise<AccountWithBalance[]> {
  const rows = await db.select().from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), opts.includeArchived ? undefined : eq(schema.accounts.status, "active")))
    .orderBy(asc(schema.accounts.sortOrder), asc(schema.accounts.createdAt));
  const bal = await accountBalances(db, userId);
  return rows.map((r) => ({ ...r, balance: bal.get(r.id) ?? r.openingBalance }));
}

export async function getAccount(db: Exec, userId: string, id: string): Promise<Account> {
  const rows = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, userId))).limit(1);
  if (!rows[0]) throw notFound();
  return rows[0];
}

const DEFAULT_ICON: Record<AccountType, string> = {
  cash: "wallet", bank: "landmark", savings: "piggy-bank", investment: "trending-up", ewallet: "smartphone",
  credit: "credit-card", loan: "hand-coins", other: "circle",
};

export async function createAccount(db: Exec, userId: string, input: z.infer<typeof accountInput>) {
  const openingDate = input.openingDate ?? (await userToday(userId, db));
  return db.transaction(async (tx) => {
    const [acc] = await tx.insert(schema.accounts).values({
      userId,
      name: input.name,
      type: input.type,
      institution: input.institution ?? null,
      icon: input.icon ?? DEFAULT_ICON[input.type],
      color: input.color ?? "#0f766e",
      currency: input.currency,
      openingBalance: input.openingBalance,
      openingDate,
      notes: input.notes ?? null,
    }).returning();
    // The opening balance is a balance snapshot — not an income transaction.
    await tx.insert(schema.balanceSnapshots).values({
      userId, accountId: acc.id, kind: "opening",
      actualBalance: input.openingBalance, calculatedBalance: input.openingBalance, difference: 0,
      effectiveDate: openingDate,
    });
    await audit(tx, userId, "account", acc.id, "create", undefined, acc);
    await markSyncDirty(tx, userId);
    return acc;
  });
}

async function txCount(db: Exec, userId: string, accountId: string) {
  const t = schema.transactions;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t)
    .where(and(eq(t.userId, userId), sql`(${t.fromAccountId} = ${accountId} or ${t.toAccountId} = ${accountId})`));
  return Number(r?.n ?? 0);
}

export async function updateAccount(db: Exec, userId: string, id: string, patch: z.infer<typeof accountPatch>) {
  const before = await getAccount(db, userId, id);
  if (patch.currency && patch.currency !== before.currency && (await txCount(db, userId, id)) > 0) {
    throw badRequest("currency_locked", "Currency cannot change once the account has transactions");
  }
  return db.transaction(async (tx) => {
    const [after] = await tx.update(schema.accounts).set({
      ...patch,
      institution: patch.institution === undefined ? undefined : patch.institution ?? null,
      notes: patch.notes === undefined ? undefined : patch.notes ?? null,
      updatedAt: new Date(),
    }).where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, userId))).returning();
    if (patch.openingBalance !== undefined && patch.openingBalance !== before.openingBalance) {
      await tx.update(schema.balanceSnapshots).set({
        actualBalance: patch.openingBalance, calculatedBalance: patch.openingBalance, effectiveDate: after.openingDate,
      }).where(and(eq(schema.balanceSnapshots.accountId, id), eq(schema.balanceSnapshots.userId, userId), eq(schema.balanceSnapshots.kind, "opening")));
    }
    await audit(tx, userId, "account", id, "update", before, after);
    await markSyncDirty(tx, userId);
    return after;
  });
}

export async function deleteAccount(db: Exec, userId: string, id: string) {
  const acc = await getAccount(db, userId, id);
  if ((await txCount(db, userId, id)) > 0) {
    throw new HttpError(409, "account_has_transactions", "Archive accounts that have transactions instead of deleting them");
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, userId)));
    await audit(tx, userId, "account", id, "delete", acc);
    await markSyncDirty(tx, userId);
  });
}

/**
 * Reconcile: compare the user's actual balance with the calculated one. Any
 * difference is recorded as an explicit balance adjustment (never income/expense).
 */
export async function reconcileAccount(db: Exec, userId: string, id: string, input: { actualBalance: number; date?: string; note?: string | null }) {
  const acc = await getAccount(db, userId, id);
  const date = input.date ?? (await userToday(userId, db));
  if (date < acc.openingDate) throw badRequest("before_opening", "Reconciliation date is before the opening balance date");
  const calculated = (await accountBalances(db, userId, date)).get(id) ?? 0;
  const diff = input.actualBalance - calculated;
  return db.transaction(async (tx) => {
    let adjustmentTxId: string | null = null;
    if (diff !== 0) {
      const adj = await createTransaction(tx, userId, {
        type: "adjustment",
        amount: Math.abs(diff),
        currency: acc.currency,
        fromAccountId: diff < 0 ? id : null,
        toAccountId: diff > 0 ? id : null,
        date,
        description: input.note || "Balance reconciliation",
      }, { skipAlerts: true });
      adjustmentTxId = adj.id;
    }
    const [snap] = await tx.insert(schema.balanceSnapshots).values({
      userId, accountId: id, kind: "reconciliation", actualBalance: input.actualBalance,
      calculatedBalance: calculated, difference: diff, effectiveDate: date, adjustmentTxId, note: input.note ?? null,
    }).returning();
    await audit(tx, userId, "account", id, "reconcile", { calculated }, { actual: input.actualBalance, diff });
    return snap;
  });
}

export async function listSnapshots(db: Exec, userId: string, accountId?: string) {
  const s = schema.balanceSnapshots;
  return db.select().from(s)
    .where(and(eq(s.userId, userId), accountId ? eq(s.accountId, accountId) : undefined))
    .orderBy(sql`${s.effectiveDate} desc, ${s.createdAt} desc`);
}

export function accountGroup(type: string): "cash" | "savings" | "investment" | "liability" | "other" {
  if ((CASH_TYPES as string[]).includes(type)) return "cash";
  if (type === "savings") return "savings";
  if (type === "investment") return "investment";
  if ((LIABILITY_TYPES as string[]).includes(type)) return "liability";
  return "other";
}

export async function primaryCurrency(db: Exec, userId: string) {
  return (await getSettings(userId, db)).primaryCurrency;
}
