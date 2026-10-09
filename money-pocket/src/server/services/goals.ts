import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db";
import { ASSET_TYPES } from "@/lib/domain";
import { convertMinor, CURRENCY_CODES } from "@/lib/money";
import { isDateStr } from "@/lib/dates";
import { badRequest, notFound } from "../http";
import { audit, markSyncDirty, type Exec } from "./common";
import { accountBalances } from "./accounts";
import { rateCache, userToday } from "./settings";

// ---------- savings goals ----------

export const goalInput = z.object({
  name: z.string().trim().min(1).max(80),
  targetAmount: z.number().int().positive().refine(Number.isSafeInteger),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  accountId: z.string().uuid().nullish(),
  targetDate: z.string().refine(isDateStr).nullish(),
  icon: z.string().max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function listGoals(db: Exec, userId: string) {
  const goals = await db.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.userId, userId)).orderBy(asc(schema.savingsGoals.createdAt));
  const bal = await accountBalances(db, userId);
  const today = await userToday(userId, db);
  const rate = rateCache(db, userId);
  const t = schema.transactions;
  const out = [];
  for (const g of goals) {
    let current = 0;
    if (g.accountId) {
      current = bal.get(g.accountId) ?? 0;
    } else {
      const rows = await db.select().from(t).where(and(eq(t.userId, userId), eq(t.goalId, g.id), isNull(t.deletedAt)));
      for (const r of rows) {
        let v = r.toAccountId ? r.amount : -r.amount;
        if (r.currency !== g.currency) {
          const rt = await rate(r.currency, g.currency, r.localDate);
          if (!rt) continue;
          v = convertMinor(v, r.currency, g.currency, rt);
        }
        current += v;
      }
    }
    const progress = g.targetAmount > 0 ? Math.max(0, current) / g.targetAmount : 0;
    let completedAt = g.completedAt;
    if (!completedAt && current >= g.targetAmount) {
      completedAt = new Date();
      await db.update(schema.savingsGoals).set({ completedAt }).where(eq(schema.savingsGoals.id, g.id));
      const { notify } = await import("./notifications");
      await notify(db, userId, { kind: "goal_completed", dedupeKey: `goal:${g.id}`, vars: { name: g.name } });
    }
    let monthlyNeeded: number | null = null;
    if (g.targetDate && current < g.targetAmount && g.targetDate > today) {
      const months = Math.max(1, (+g.targetDate.slice(0, 4) - +today.slice(0, 4)) * 12 + (+g.targetDate.slice(5, 7) - +today.slice(5, 7)));
      monthlyNeeded = Math.ceil((g.targetAmount - current) / months);
    }
    out.push({ ...g, completedAt, current, progress, monthlyNeeded });
  }
  return out;
}

async function checkGoalAccount(db: Exec, userId: string, accountId: string | null | undefined, currency: string) {
  if (!accountId) return;
  const [a] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId)));
  if (!a) throw badRequest("invalid_account");
  if (a.currency !== currency) throw badRequest("currency_mismatch", "Goal currency must match the linked account");
}

export async function createGoal(db: Exec, userId: string, input: z.infer<typeof goalInput>) {
  await checkGoalAccount(db, userId, input.accountId, input.currency);
  const [g] = await db.insert(schema.savingsGoals).values({ userId, ...input, accountId: input.accountId ?? null, targetDate: input.targetDate ?? null }).returning();
  await audit(db, userId, "goal", g.id, "create", undefined, g);
  return g;
}

export async function updateGoal(db: Exec, userId: string, id: string, patch: Partial<z.infer<typeof goalInput>>) {
  const [before] = await db.select().from(schema.savingsGoals).where(and(eq(schema.savingsGoals.id, id), eq(schema.savingsGoals.userId, userId)));
  if (!before) throw notFound();
  await checkGoalAccount(db, userId, patch.accountId === undefined ? before.accountId : patch.accountId, patch.currency ?? before.currency);
  const reopen = patch.targetAmount && patch.targetAmount > before.targetAmount ? { completedAt: null } : {};
  const [after] = await db.update(schema.savingsGoals).set({ ...patch, ...reopen }).where(eq(schema.savingsGoals.id, id)).returning();
  await audit(db, userId, "goal", id, "update", before, after);
  return after;
}

export async function deleteGoal(db: Exec, userId: string, id: string) {
  const [before] = await db.delete(schema.savingsGoals).where(and(eq(schema.savingsGoals.id, id), eq(schema.savingsGoals.userId, userId))).returning();
  if (!before) throw notFound();
  await audit(db, userId, "goal", id, "delete", before);
}

/** Contributions and withdrawals for a goal (linked account movements or goal-tagged transactions). */
export async function goalActivity(db: Exec, userId: string, id: string) {
  const [g] = await db.select().from(schema.savingsGoals).where(and(eq(schema.savingsGoals.id, id), eq(schema.savingsGoals.userId, userId)));
  if (!g) throw notFound();
  const t = schema.transactions;
  return db.select().from(t).where(and(
    eq(t.userId, userId), isNull(t.deletedAt),
    g.accountId ? or(eq(t.goalId, id), eq(t.toAccountId, g.accountId), eq(t.fromAccountId, g.accountId)) : eq(t.goalId, id),
  )).orderBy(desc(t.localDate)).limit(100);
}

// ---------- investment holdings ----------

export const holdingInput = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  symbol: z.string().trim().max(20).nullish(),
  assetType: z.enum(ASSET_TYPES),
  notes: z.string().max(1000).nullish(),
});

export const valuationInput = z.object({
  marketValue: z.number().int().min(0).refine(Number.isSafeInteger),
  valuedAt: z.string().refine(isDateStr),
});

export async function listHoldings(db: Exec, userId: string) {
  const h = schema.holdings;
  const rows = await db.select().from(h).where(eq(h.userId, userId)).orderBy(asc(h.createdAt));
  const t = schema.transactions;
  // Dividends and interest linked to each holding (income transactions with holding_id).
  const income = await db.select({ holdingId: t.holdingId, total: sql<string>`sum(${t.toAmount})` }).from(t)
    .where(and(eq(t.userId, userId), isNull(t.deletedAt), eq(t.type, "income"), sql`${t.holdingId} is not null`)).groupBy(t.holdingId);
  const realized = await db.select({ holdingId: sql<string>`p.holding_id`, total: sql<string>`sum(coalesce(${t.toAmount},0) - coalesce(${t.fromAmount},0))` })
    .from(t).innerJoin(sql`transactions p`, sql`p.id = ${t.parentId}`)
    .where(and(eq(t.userId, userId), isNull(t.deletedAt), eq(t.type, "valuation"))).groupBy(sql`p.holding_id`);
  const incomeBy = new Map(income.map((r) => [r.holdingId, Number(r.total)]));
  const realizedBy = new Map(realized.map((r) => [r.holdingId, Number(r.total)]));
  const accs = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
  return rows.map((r) => ({
    ...r,
    units: trimDecimal(r.units),
    currency: accs.find((a) => a.id === r.accountId)?.currency ?? "USD",
    unrealized: r.marketValue === null ? null : r.marketValue - r.costBasis,
    income: incomeBy.get(r.id) ?? 0,
    realized: realizedBy.get(r.id) ?? 0,
  }));
}

export async function createHolding(db: Exec, userId: string, input: z.infer<typeof holdingInput>) {
  const [a] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, input.accountId), eq(schema.accounts.userId, userId)));
  if (!a) throw badRequest("invalid_account");
  const [h] = await db.insert(schema.holdings).values({ userId, ...input, symbol: input.symbol ?? null, notes: input.notes ?? null }).returning();
  await audit(db, userId, "holding", h.id, "create", undefined, h);
  await markSyncDirty(db, userId);
  return h;
}

export async function updateHolding(db: Exec, userId: string, id: string, patch: Partial<Omit<z.infer<typeof holdingInput>, "accountId">> & Partial<z.infer<typeof valuationInput>>) {
  const [before] = await db.select().from(schema.holdings).where(and(eq(schema.holdings.id, id), eq(schema.holdings.userId, userId)));
  if (!before) throw notFound();
  const [after] = await db.update(schema.holdings).set(patch).where(eq(schema.holdings.id, id)).returning();
  await audit(db, userId, "holding", id, patch.marketValue !== undefined ? "valuation" : "update", before, after);
  await markSyncDirty(db, userId);
  return after;
}

export async function deleteHolding(db: Exec, userId: string, id: string) {
  const [before] = await db.select().from(schema.holdings).where(and(eq(schema.holdings.id, id), eq(schema.holdings.userId, userId)));
  if (!before) throw notFound();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.transactions)
    .where(and(eq(schema.transactions.holdingId, id), isNull(schema.transactions.deletedAt)));
  if (Number(n) > 0) throw badRequest("holding_has_trades", "Delete the holding's trades first");
  await db.delete(schema.holdings).where(eq(schema.holdings.id, id));
  await audit(db, userId, "holding", id, "delete", before);
}

/** "50.0000000000" -> "50" */
export function trimDecimal(v: string) {
  return v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
}
