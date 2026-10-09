import { and, asc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db";
import { RECURRING_FREQ, USER_TX_TYPES, type TxType } from "@/lib/domain";
import { CURRENCY_CODES } from "@/lib/money";
import { addDays, addMonths, isDateStr } from "@/lib/dates";
import { badRequest, notFound } from "../http";
import { audit, type Exec } from "./common";
import { createTransaction } from "./transactions";
import { userToday } from "./settings";

export const recurringInput = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(USER_TX_TYPES as [TxType, ...TxType[]]),
  amount: z.number().int().positive().refine(Number.isSafeInteger),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  fromAccountId: z.string().uuid().nullish(),
  toAccountId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  frequency: z.enum(RECURRING_FREQ),
  startDate: z.string().refine(isDateStr),
  endDate: z.string().refine(isDateStr).nullish(),
  reminderDaysBefore: z.number().int().min(0).max(30).default(1),
  autoPost: z.boolean().default(false),
  active: z.boolean().optional(),
});

export function nextOccurrence(date: string, freq: string, start: string): string {
  switch (freq) {
    case "daily": return addDays(date, 1);
    case "weekly": return addDays(date, 7);
    case "biweekly": return addDays(date, 14);
    case "quarterly": return keepDay(addMonths(date, 3), start);
    case "yearly": return keepDay(addMonths(date, 12), start);
    default: return keepDay(addMonths(date, 1), start);
  }
}

/** Monthly rules started on the 31st should return to the 31st after short months. */
function keepDay(d: string, start: string) {
  const want = +start.slice(8, 10);
  const last = +addDays(addMonths(d.slice(0, 8) + "01", 1), -1).slice(8, 10);
  return d.slice(0, 8) + String(Math.min(want, last)).padStart(2, "0");
}

async function checkRefs(db: Exec, userId: string, input: Partial<z.infer<typeof recurringInput>>) {
  for (const id of [input.fromAccountId, input.toAccountId]) {
    if (!id) continue;
    const [a] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, userId)));
    if (!a) throw badRequest("invalid_account");
  }
  if (input.categoryId) {
    const [c] = await db.select().from(schema.categories).where(and(eq(schema.categories.id, input.categoryId), eq(schema.categories.userId, userId)));
    if (!c) throw badRequest("invalid_category");
  }
}

export async function listRecurring(db: Exec, userId: string) {
  const today = await userToday(userId, db);
  const rows = await db.select().from(schema.recurringRules).where(eq(schema.recurringRules.userId, userId)).orderBy(asc(schema.recurringRules.nextDueDate));
  return rows.map((r) => {
    const ended = !!r.endDate && r.nextDueDate > r.endDate;
    const status = !r.active || ended ? "inactive" : r.nextDueDate < today ? "overdue" : r.nextDueDate === today ? "due" : addDays(today, r.reminderDaysBefore) >= r.nextDueDate ? "upcoming" : "scheduled";
    return { ...r, status };
  });
}

export async function createRecurring(db: Exec, userId: string, input: z.infer<typeof recurringInput>) {
  await checkRefs(db, userId, input);
  const [r] = await db.insert(schema.recurringRules).values({
    userId, ...input, fromAccountId: input.fromAccountId ?? null, toAccountId: input.toAccountId ?? null,
    categoryId: input.categoryId ?? null, endDate: input.endDate ?? null, nextDueDate: input.startDate,
  }).returning();
  await audit(db, userId, "recurring", r.id, "create", undefined, r);
  return r;
}

export async function updateRecurring(db: Exec, userId: string, id: string, patch: Partial<z.infer<typeof recurringInput>>) {
  const [before] = await db.select().from(schema.recurringRules).where(and(eq(schema.recurringRules.id, id), eq(schema.recurringRules.userId, userId)));
  if (!before) throw notFound();
  await checkRefs(db, userId, patch);
  const extra = patch.startDate && patch.startDate !== before.startDate ? { nextDueDate: patch.startDate } : {};
  const [after] = await db.update(schema.recurringRules).set({ ...patch, ...extra }).where(eq(schema.recurringRules.id, id)).returning();
  await audit(db, userId, "recurring", id, "update", before, after);
  return after;
}

export async function deleteRecurring(db: Exec, userId: string, id: string) {
  const [before] = await db.delete(schema.recurringRules).where(and(eq(schema.recurringRules.id, id), eq(schema.recurringRules.userId, userId))).returning();
  if (!before) throw notFound();
  await audit(db, userId, "recurring", id, "delete", before);
}

/** Post the next occurrence as a real transaction (explicit user action or auto-post rule). */
export async function postRecurring(db: Exec, userId: string, id: string, opts: { amount?: number; date?: string; skip?: boolean } = {}) {
  const [r] = await db.select().from(schema.recurringRules).where(and(eq(schema.recurringRules.id, id), eq(schema.recurringRules.userId, userId)));
  if (!r) throw notFound();
  if (!r.active) throw badRequest("inactive");
  return db.transaction(async (tx) => {
    let created = null;
    if (!opts.skip) {
      created = await createTransaction(tx, userId, {
        type: r.type as TxType, amount: opts.amount ?? r.amount, currency: r.currency,
        fromAccountId: r.fromAccountId, toAccountId: r.toAccountId, categoryId: r.categoryId,
        date: opts.date ?? r.nextDueDate, description: r.name, recurringId: r.id,
      });
    }
    const next = nextOccurrence(r.nextDueDate, r.frequency, r.startDate);
    const active = !r.endDate || next <= r.endDate;
    await tx.update(schema.recurringRules).set({ nextDueDate: next, active }).where(eq(schema.recurringRules.id, r.id));
    return { transaction: created, nextDueDate: next };
  });
}

/** Auto-post rules whose posting rule is satisfied (autoPost and due date reached). */
export async function autoPostDue(db: Exec, userId: string, today: string) {
  const due = await db.select().from(schema.recurringRules).where(and(
    eq(schema.recurringRules.userId, userId), eq(schema.recurringRules.active, true),
    eq(schema.recurringRules.autoPost, true), lte(schema.recurringRules.nextDueDate, today),
  ));
  let posted = 0;
  for (const r of due) {
    // Catch up at most 12 missed occurrences per run.
    let guard = 12;
    let next = r.nextDueDate;
    while (next <= today && guard-- > 0) {
      try {
        const res = await postRecurring(db, userId, r.id);
        posted++;
        next = res.nextDueDate;
      } catch (e) {
        console.error("auto-post failed", r.id, e);
        break;
      }
    }
  }
  return posted;
}
