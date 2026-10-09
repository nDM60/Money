import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db";
import { BUDGET_PERIODS } from "@/lib/domain";
import { CURRENCY_CODES } from "@/lib/money";
import { isDateStr } from "@/lib/dates";
import { badRequest, notFound } from "../http";
import { audit, markSyncDirty, type Exec } from "./common";
import { getSettings, userToday } from "./settings";

// ---------- categories ----------

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["expense", "income"]),
  icon: z.string().max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  parentId: z.string().uuid().nullish(),
});

export async function listCategories(db: Exec, userId: string) {
  return db.select().from(schema.categories).where(eq(schema.categories.userId, userId)).orderBy(asc(schema.categories.kind), asc(schema.categories.createdAt));
}

async function checkParent(db: Exec, userId: string, parentId: string | null | undefined, kind: string, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw badRequest("invalid_parent");
  const [p] = await db.select().from(schema.categories).where(and(eq(schema.categories.id, parentId), eq(schema.categories.userId, userId)));
  if (!p || p.kind !== kind || p.parentId) throw badRequest("invalid_parent", "Parent must be a top-level category of the same kind");
}

export async function createCategory(db: Exec, userId: string, input: z.infer<typeof categoryInput>) {
  await checkParent(db, userId, input.parentId, input.kind);
  const [c] = await db.insert(schema.categories).values({ userId, ...input, parentId: input.parentId ?? null }).returning();
  await audit(db, userId, "category", c.id, "create", undefined, c);
  await markSyncDirty(db, userId);
  return c;
}

export async function updateCategory(db: Exec, userId: string, id: string, patch: Partial<z.infer<typeof categoryInput>> & { archived?: boolean }) {
  const [before] = await db.select().from(schema.categories).where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId)));
  if (!before) throw notFound();
  if (patch.kind && patch.kind !== before.kind) throw badRequest("kind_locked");
  await checkParent(db, userId, patch.parentId, before.kind, id);
  const [after] = await db.update(schema.categories).set(patch).where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId))).returning();
  await audit(db, userId, "category", id, "update", before, after);
  await markSyncDirty(db, userId);
  return after;
}

export async function deleteCategory(db: Exec, userId: string, id: string) {
  const [before] = await db.select().from(schema.categories).where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId)));
  if (!before) throw notFound();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.transactions)
    .where(and(eq(schema.transactions.userId, userId), eq(schema.transactions.categoryId, id)));
  if (Number(n) > 0) {
    // Keep history intact: archive instead of deleting a category in use.
    return updateCategory(db, userId, id, { archived: true });
  }
  await db.update(schema.categories).set({ parentId: null }).where(and(eq(schema.categories.parentId, id), eq(schema.categories.userId, userId)));
  await db.delete(schema.categories).where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId)));
  await audit(db, userId, "category", id, "delete", before);
  await markSyncDirty(db, userId);
  return null;
}

// ---------- budgets ----------

export const budgetInput = z.object({
  categoryId: z.string().uuid().nullish(),
  period: z.enum(BUDGET_PERIODS),
  amount: z.number().int().positive().refine(Number.isSafeInteger),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]).optional(),
  thresholds: z.array(z.number().int().min(1).max(200)).max(5).optional(),
  rollover: z.boolean().optional(),
  startDate: z.string().refine(isDateStr).optional(),
  active: z.boolean().optional(),
});

export async function listBudgets(db: Exec, userId: string) {
  return db.select().from(schema.budgets).where(eq(schema.budgets.userId, userId)).orderBy(asc(schema.budgets.createdAt));
}

export async function createBudget(db: Exec, userId: string, input: z.infer<typeof budgetInput>) {
  if (input.categoryId) {
    const [c] = await db.select().from(schema.categories).where(and(eq(schema.categories.id, input.categoryId), eq(schema.categories.userId, userId)));
    if (!c || c.kind !== "expense") throw badRequest("invalid_category");
  }
  const s = await getSettings(userId, db);
  const [b] = await db.insert(schema.budgets).values({
    userId,
    categoryId: input.categoryId ?? null,
    period: input.period,
    amount: input.amount,
    currency: input.currency ?? s.primaryCurrency,
    thresholds: input.thresholds ?? [80, 90, 100],
    rollover: input.rollover ?? false,
    startDate: input.startDate ?? (await userToday(userId, db)),
  }).returning();
  await audit(db, userId, "budget", b.id, "create", undefined, b);
  await markSyncDirty(db, userId);
  return b;
}

export async function updateBudget(db: Exec, userId: string, id: string, patch: Partial<z.infer<typeof budgetInput>>) {
  const [before] = await db.select().from(schema.budgets).where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, userId)));
  if (!before) throw notFound();
  const [after] = await db.update(schema.budgets).set(patch).where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, userId))).returning();
  await audit(db, userId, "budget", id, "update", before, after);
  await markSyncDirty(db, userId);
  return after;
}

export async function deleteBudget(db: Exec, userId: string, id: string) {
  const [before] = await db.delete(schema.budgets).where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, userId))).returning();
  if (!before) throw notFound();
  await audit(db, userId, "budget", id, "delete", before);
  await markSyncDirty(db, userId);
}
