import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db";
import { TX_SHAPE, TX_TYPES, USER_TX_TYPES, type TxType } from "@/lib/domain";
import { convertMinor, CURRENCY_CODES } from "@/lib/money";
import { isDateStr, zonedToUtc, localTimeOf } from "@/lib/dates";
import { badRequest, HttpError, notFound } from "../http";
import { audit, markSyncDirty, type Exec } from "./common";
import { findRate, getSettings } from "./settings";

export type Transaction = typeof schema.transactions.$inferSelect;

const minor = z.number().int().positive().refine(Number.isSafeInteger);
const unitsStr = z.string().regex(/^\d+(\.\d{1,10})?$/);

export const txInput = z.object({
  type: z.enum(USER_TX_TYPES as [TxType, ...TxType[]]),
  amount: minor,
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  fromAccountId: z.string().uuid().nullish(),
  toAccountId: z.string().uuid().nullish(),
  /** Explicit amounts for cross-currency movements (minor units of each account's currency). */
  fromAmount: minor.nullish(),
  toAmount: minor.nullish(),
  date: z.string().refine(isDateStr, "invalid date"),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  categoryId: z.string().uuid().nullish(),
  description: z.string().trim().max(200).default(""),
  merchant: z.string().trim().max(120).nullish(),
  paymentMethod: z.string().max(40).nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  notes: z.string().max(2000).nullish(),
  receiptId: z.string().uuid().nullish(),
  recurringId: z.string().uuid().nullish(),
  goalId: z.string().uuid().nullish(),
  holdingId: z.string().uuid().nullish(),
  units: unitsStr.nullish(),
});
export type TxInput = z.input<typeof txInput>;

interface CreateOpts {
  skipAlerts?: boolean;
  /** Internal: allow system types like "valuation". */
  system?: boolean;
  parentId?: string;
}

async function ownedAccount(db: Exec, userId: string, id: string) {
  const [a] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, userId))).limit(1);
  if (!a) throw badRequest("invalid_account", "Account not found");
  return a;
}

async function ownedRow<T extends { userId: string }>(rows: T[], code: string): Promise<T> {
  if (!rows[0]) throw badRequest(code);
  return rows[0];
}

export class RateMissingError extends HttpError {
  constructor(public from: string, public to: string) {
    super(400, "rate_missing", `No exchange rate configured for ${from} → ${to}`);
  }
}

async function convertOrThrow(db: Exec, userId: string, amount: number, from: string, to: string, date: string) {
  if (from === to) return { value: amount, rate: "1" };
  const rate = await findRate(db, userId, from, to, date);
  if (!rate) throw new RateMissingError(from, to);
  return { value: convertMinor(amount, from, to, rate), rate };
}

// ---- unit math (10 decimal places, exact) ----
const U = 10n ** 10n;
function units(s: string | null | undefined): bigint {
  if (!s) return 0n;
  const [i, f = ""] = s.split(".");
  return BigInt(i) * U + BigInt((f + "0000000000").slice(0, 10));
}
function unitsToStr(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = (a / U).toString() + "." + (a % U).toString().padStart(10, "0");
  return (neg ? "-" : "") + s.replace(/\.?0+$/, "");
}

/** Validate and normalize a transaction into a row ready to insert. */
async function buildRow(db: Exec, userId: string, input: z.infer<typeof txInput> & { type: TxType }) {
  const shape = TX_SHAPE[input.type];
  const from = input.fromAccountId ?? null;
  const to = input.toAccountId ?? null;
  if (shape.from === "required" && !from) throw badRequest("from_required", "Source account is required");
  if (shape.to === "required" && !to) throw badRequest("to_required", "Destination account is required");
  if (shape.from === "none" && from) throw badRequest("from_not_allowed");
  if (shape.to === "none" && to) throw badRequest("to_not_allowed");
  if (shape.from === "either" && !!from === !!to) throw badRequest("one_side_required", "Choose exactly one account");
  if (from && to && from === to) throw badRequest("same_account", "Source and destination must differ");

  const settings = await getSettings(userId, db);
  const fromAcc = from ? await ownedAccount(db, userId, from) : null;
  const toAcc = to ? await ownedAccount(db, userId, to) : null;

  let fromAmount: number | null = null;
  let toAmount: number | null = null;
  if (fromAcc) {
    fromAmount = fromAcc.currency === input.currency ? input.amount
      : input.fromAmount ?? (await convertOrThrow(db, userId, input.amount, input.currency, fromAcc.currency, input.date)).value;
  }
  if (toAcc) {
    toAmount = toAcc.currency === input.currency ? input.amount
      : input.toAmount ?? (await convertOrThrow(db, userId, input.amount, input.currency, toAcc.currency, input.date)).value;
  }

  const rep = await convertOrThrow(db, userId, input.amount, input.currency, settings.primaryCurrency, input.date);

  if (input.categoryId) {
    const cat = await ownedRow(await db.select().from(schema.categories)
      .where(and(eq(schema.categories.id, input.categoryId), eq(schema.categories.userId, userId))).limit(1), "invalid_category");
    const report = shape.report;
    if ((report === "expense" && cat.kind !== "expense") || (report === "income" && cat.kind !== "income")) {
      throw badRequest("category_kind_mismatch", "Category does not match the transaction type");
    }
  }
  if (input.goalId) {
    await ownedRow(await db.select().from(schema.savingsGoals)
      .where(and(eq(schema.savingsGoals.id, input.goalId), eq(schema.savingsGoals.userId, userId))).limit(1), "invalid_goal");
  }
  if (input.receiptId) {
    await ownedRow(await db.select({ userId: schema.receipts.userId }).from(schema.receipts)
      .where(and(eq(schema.receipts.id, input.receiptId), eq(schema.receipts.userId, userId))).limit(1), "invalid_receipt");
  }
  if (input.recurringId) {
    await ownedRow(await db.select({ userId: schema.recurringRules.userId }).from(schema.recurringRules)
      .where(and(eq(schema.recurringRules.id, input.recurringId), eq(schema.recurringRules.userId, userId))).limit(1), "invalid_recurring");
  }

  const time = input.time ?? localTimeOf(new Date(), settings.timezone);
  const occurredAt = zonedToUtc(input.date, time, settings.timezone);

  return {
    userId,
    type: input.type,
    occurredAt,
    localDate: input.date,
    fromAccountId: from,
    toAccountId: to,
    amount: input.amount,
    currency: input.currency,
    fromAmount,
    toAmount,
    reportingCurrency: settings.primaryCurrency,
    reportingAmount: rep.value,
    fxRate: rep.rate,
    categoryId: input.categoryId ?? null,
    description: input.description ?? "",
    merchant: input.merchant ?? null,
    paymentMethod: input.paymentMethod ?? null,
    tags: input.tags ?? [],
    notes: input.notes ?? null,
    receiptId: input.receiptId ?? null,
    recurringId: input.recurringId ?? null,
    goalId: input.goalId ?? null,
    holdingId: input.holdingId ?? null,
    units: input.units ?? null,
  } satisfies typeof schema.transactions.$inferInsert;
}

/** Apply (sign=1) or reverse (sign=-1) a transaction's effect on an investment holding. */
async function applyHolding(db: Exec, userId: string, row: Transaction, sign: 1 | -1) {
  if (!row.holdingId || (row.type !== "investment_purchase" && row.type !== "investment_sale")) return;
  const [h] = await db.select().from(schema.holdings)
    .where(and(eq(schema.holdings.id, row.holdingId), eq(schema.holdings.userId, userId))).limit(1);
  if (!h) throw badRequest("invalid_holding");
  const u = units(row.units);
  if (u <= 0n) throw badRequest("units_required", "Units are required for holding transactions");

  if (row.type === "investment_purchase") {
    if (h.accountId !== row.toAccountId) throw badRequest("holding_account_mismatch");
    const newUnits = units(h.units) + BigInt(sign) * u;
    const newCost = h.costBasis + sign * (row.toAmount ?? 0);
    if (newUnits < 0n || newCost < 0) throw badRequest("holding_underflow");
    await db.update(schema.holdings).set({ units: unitsToStr(newUnits), costBasis: newCost }).where(eq(schema.holdings.id, h.id));
    return;
  }

  // investment_sale
  if (h.accountId !== row.fromAccountId) throw badRequest("holding_account_mismatch");
  const proceeds = row.fromAmount ?? 0;
  if (sign === 1) {
    const held = units(h.units);
    if (u > held) throw badRequest("insufficient_units", "Selling more units than held");
    // Average-cost basis of the units sold, rounded to minor units.
    const costPortion = Number((BigInt(h.costBasis) * u * 2n + held) / (2n * held));
    await db.update(schema.holdings).set({ units: unitsToStr(held - u), costBasis: h.costBasis - costPortion }).where(eq(schema.holdings.id, h.id));
    const gain = proceeds - costPortion;
    if (gain !== 0) {
      const acc = await ownedAccount(db, userId, row.fromAccountId!);
      // Realized gain/loss is a valuation entry on the investment account — not ordinary income.
      await createTransaction(db, userId, {
        type: "valuation",
        amount: Math.abs(gain),
        currency: acc.currency,
        fromAccountId: gain < 0 ? row.fromAccountId : null,
        toAccountId: gain > 0 ? row.fromAccountId : null,
        date: row.localDate,
        description: `Realized ${gain > 0 ? "gain" : "loss"}: ${h.name}`,
      } as TxInput, { system: true, parentId: row.id, skipAlerts: true });
    }
  } else {
    const children = await db.select().from(schema.transactions)
      .where(and(eq(schema.transactions.parentId, row.id), eq(schema.transactions.userId, userId), isNull(schema.transactions.deletedAt)));
    let gain = 0;
    for (const c of children) {
      gain += (c.toAmount ?? 0) - (c.fromAmount ?? 0);
      await db.update(schema.transactions).set({ deletedAt: new Date() }).where(eq(schema.transactions.id, c.id));
    }
    const costPortion = proceeds - gain;
    await db.update(schema.holdings).set({
      units: unitsToStr(units(h.units) + u), costBasis: h.costBasis + costPortion,
    }).where(eq(schema.holdings.id, h.id));
  }
}

export async function createTransaction(db: Exec, userId: string, raw: TxInput, opts: CreateOpts = {}): Promise<Transaction> {
  const parsed = opts.system
    ? txInput.extend({ type: z.enum(TX_TYPES) }).parse(raw)
    : txInput.parse(raw);
  const out = await db.transaction(async (tx) => {
    const row = await buildRow(tx, userId, parsed);
    const [created] = await tx.insert(schema.transactions).values({ ...row, parentId: opts.parentId ?? null }).returning();
    await applyHolding(tx, userId, created, 1);
    if (created.receiptId) {
      await tx.update(schema.receipts).set({ status: "confirmed", transactionId: created.id })
        .where(and(eq(schema.receipts.id, created.receiptId), eq(schema.receipts.userId, userId)));
    }
    await audit(tx, userId, "transaction", created.id, "create", undefined, created);
    await markSyncDirty(tx, userId);
    return created;
  });
  if (!opts.skipAlerts && out.type === "expense") {
    const { checkBudgetAlerts } = await import("./notifications");
    await checkBudgetAlerts(db, userId).catch((e) => console.error("budget alert check failed", e));
  }
  return out;
}

export async function getTransaction(db: Exec, userId: string, id: string, opts: { includeDeleted?: boolean } = {}) {
  const t = schema.transactions;
  const [row] = await db.select().from(t)
    .where(and(eq(t.id, id), eq(t.userId, userId), opts.includeDeleted ? undefined : isNull(t.deletedAt))).limit(1);
  if (!row) throw notFound();
  return row;
}

const FINANCIAL_FIELDS = ["type", "amount", "currency", "fromAccountId", "toAccountId", "fromAmount", "toAmount", "holdingId", "units"] as const;

export async function updateTransaction(db: Exec, userId: string, id: string, patch: Partial<TxInput>) {
  const before = await getTransaction(db, userId, id);
  if (before.type === "valuation" || before.parentId) throw badRequest("system_transaction", "System-generated entries cannot be edited");
  if (before.holdingId && FINANCIAL_FIELDS.some((f) => patch[f] !== undefined && patch[f] !== (before as Record<string, unknown>)[f])) {
    throw badRequest("holding_locked", "Delete and re-enter investment trades to change amounts or units");
  }
  const settings = await getSettings(userId, db);
  const merged: TxInput = {
    type: before.type as TxType,
    amount: before.amount,
    currency: before.currency,
    fromAccountId: before.fromAccountId,
    toAccountId: before.toAccountId,
    fromAmount: before.fromAmount,
    toAmount: before.toAmount,
    date: before.localDate,
    time: localTimeOf(before.occurredAt, settings.timezone),
    categoryId: before.categoryId,
    description: before.description,
    merchant: before.merchant,
    paymentMethod: before.paymentMethod,
    tags: before.tags,
    notes: before.notes,
    receiptId: before.receiptId,
    recurringId: before.recurringId,
    goalId: before.goalId,
    holdingId: before.holdingId,
    units: before.units,
    ...patch,
  };
  // When the amount or accounts change, recompute converted amounts unless given explicitly.
  if (patch.amount !== undefined || patch.currency !== undefined || patch.fromAccountId !== undefined || patch.toAccountId !== undefined) {
    if (patch.fromAmount === undefined) merged.fromAmount = null;
    if (patch.toAmount === undefined) merged.toAmount = null;
  }
  const parsed = txInput.parse(merged);
  return db.transaction(async (tx) => {
    const row = await buildRow(tx, userId, parsed);
    // Keep the original reporting snapshot unless the money itself changed.
    const moneyChanged = row.amount !== before.amount || row.currency !== before.currency || row.localDate !== before.localDate;
    const values = moneyChanged ? row : { ...row, reportingCurrency: before.reportingCurrency, reportingAmount: before.reportingAmount, fxRate: before.fxRate };
    const [after] = await tx.update(schema.transactions).set({ ...values, updatedAt: new Date() })
      .where(and(eq(schema.transactions.id, id), eq(schema.transactions.userId, userId))).returning();
    await audit(tx, userId, "transaction", id, "update", before, after);
    await markSyncDirty(tx, userId);
    return after;
  });
}

/** Soft delete so the action can be undone. */
export async function deleteTransaction(db: Exec, userId: string, id: string) {
  const before = await getTransaction(db, userId, id);
  if (before.parentId) throw badRequest("system_transaction", "Delete the parent trade instead");
  await db.transaction(async (tx) => {
    await applyHolding(tx, userId, before, -1);
    await tx.update(schema.transactions).set({ deletedAt: new Date() }).where(eq(schema.transactions.id, id));
    await audit(tx, userId, "transaction", id, "delete", before);
    await markSyncDirty(tx, userId);
  });
}

export async function restoreTransaction(db: Exec, userId: string, id: string) {
  const row = await getTransaction(db, userId, id, { includeDeleted: true });
  if (!row.deletedAt) return row;
  return db.transaction(async (tx) => {
    const [after] = await tx.update(schema.transactions).set({ deletedAt: null }).where(eq(schema.transactions.id, id)).returning();
    await applyHolding(tx, userId, after, 1);
    await audit(tx, userId, "transaction", id, "restore", undefined, after);
    await markSyncDirty(tx, userId);
    return after;
  });
}

export async function duplicateTransaction(db: Exec, userId: string, id: string, date: string) {
  const src = await getTransaction(db, userId, id);
  if (src.type === "valuation") throw badRequest("system_transaction");
  return createTransaction(db, userId, {
    type: src.type as TxType, amount: src.amount, currency: src.currency,
    fromAccountId: src.fromAccountId, toAccountId: src.toAccountId,
    fromAmount: src.fromAmount, toAmount: src.toAmount, date,
    categoryId: src.categoryId, description: src.description, merchant: src.merchant,
    paymentMethod: src.paymentMethod, tags: src.tags, notes: src.notes, goalId: src.goalId,
  });
}

export const listQuery = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  type: z.string().optional(), // comma separated
  start: z.string().refine(isDateStr).optional(),
  end: z.string().refine(isDateStr).optional(),
  min: z.coerce.number().int().optional(),
  max: z.coerce.number().int().optional(),
  q: z.string().max(100).optional(),
  uncategorized: z.enum(["1"]).optional(),
  sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).default("date_desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
});
export type ListQuery = z.infer<typeof listQuery>;

export function txFilters(userId: string, q: Partial<ListQuery>): SQL[] {
  const t = schema.transactions;
  const conds: SQL[] = [eq(t.userId, userId), isNull(t.deletedAt)];
  if (q.accountId) conds.push(or(eq(t.fromAccountId, q.accountId), eq(t.toAccountId, q.accountId))!);
  if (q.categoryId) conds.push(eq(t.categoryId, q.categoryId));
  if (q.type) {
    const types = q.type.split(",").filter((x) => (TX_TYPES as readonly string[]).includes(x));
    if (types.length) conds.push(inArray(t.type, types));
  }
  if (q.start) conds.push(gte(t.localDate, q.start));
  if (q.end) conds.push(lte(t.localDate, q.end));
  if (q.min !== undefined) conds.push(gte(t.reportingAmount, q.min));
  if (q.max !== undefined) conds.push(lte(t.reportingAmount, q.max));
  if (q.uncategorized) conds.push(isNull(t.categoryId), inArray(t.type, ["income", "expense", "refund"]));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    conds.push(or(ilike(t.description, like), ilike(t.merchant, like), ilike(t.notes, like), sql`array_to_string(${t.tags}, ' ') ilike ${like}`)!);
  }
  return conds;
}

export async function listTransactions(db: Exec, userId: string, q: ListQuery) {
  const t = schema.transactions;
  const where = and(...txFilters(userId, q));
  const order = {
    date_desc: [desc(t.localDate), desc(t.occurredAt), desc(t.createdAt)],
    date_asc: [asc(t.localDate), asc(t.occurredAt), asc(t.createdAt)],
    amount_desc: [desc(t.reportingAmount), desc(t.localDate)],
    amount_asc: [asc(t.reportingAmount), desc(t.localDate)],
  }[q.sort];
  const [items, [{ n }]] = await Promise.all([
    db.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(t).where(where),
  ]);
  return { items, total: Number(n), page: q.page, pageSize: q.pageSize };
}

/** Possible duplicates: same amount & currency within ±1 day, optionally same merchant. */
export async function findPossibleDuplicates(db: Exec, userId: string, p: { amount: number; currency: string; date: string; merchant?: string | null }) {
  const t = schema.transactions;
  const rows = await db.select().from(t).where(and(
    eq(t.userId, userId), isNull(t.deletedAt), eq(t.amount, p.amount), eq(t.currency, p.currency),
    sql`${t.localDate} between (${p.date}::date - 1) and (${p.date}::date + 1)`,
  )).limit(5);
  return rows;
}
