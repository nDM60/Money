import { and, desc, eq, lte, or } from "drizzle-orm";
import { getDb, schema } from "../db";
import { DEFAULT_CATEGORIES } from "@/lib/domain";
import { invertRate } from "@/lib/money";
import { todayIn } from "@/lib/dates";
import { CATEGORY_NAMES } from "@/lib/i18n/categories";
import type { Exec } from "./common";

export type Settings = typeof schema.userSettings.$inferSelect;

export async function getSettings(userId: string, db?: Exec): Promise<Settings> {
  const d = db ?? (await getDb());
  const rows = await d.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await d.insert(schema.userSettings).values({ userId }).onConflictDoNothing().returning();
  return created ?? (await getSettings(userId, d));
}

export async function userToday(userId: string, db?: Exec) {
  const s = await getSettings(userId, db);
  return todayIn(s.timezone);
}

/** Create default settings and categories for a brand-new user. */
export async function seedNewUser(db: Exec, userId: string, init: { language: string; currency: string; timezone: string }) {
  await db.insert(schema.userSettings).values({
    userId, language: init.language, primaryCurrency: init.currency, timezone: init.timezone,
  }).onConflictDoNothing();
  await db.insert(schema.categories).values(
    DEFAULT_CATEGORIES.map((c) => ({
      userId,
      name: CATEGORY_NAMES[init.language as "en"]?.[c.key] ?? CATEGORY_NAMES.en[c.key] ?? c.key,
      systemKey: c.key,
      kind: c.kind,
      icon: c.icon,
      color: c.color,
    })),
  );
}

/**
 * Find the exchange rate (units of `to` per 1 `from`) effective on `date`,
 * from the user's configured rates. Tries the direct pair, then the inverse.
 */
export async function findRate(db: Exec, userId: string, from: string, to: string, date: string): Promise<string | null> {
  if (from === to) return "1";
  const r = schema.exchangeRates;
  const rows = await db
    .select()
    .from(r)
    .where(and(
      eq(r.userId, userId),
      lte(r.effectiveDate, date),
      or(and(eq(r.base, from), eq(r.quote, to)), and(eq(r.base, to), eq(r.quote, from))),
    ))
    .orderBy(desc(r.effectiveDate), desc(r.createdAt))
    .limit(1);
  let row = rows[0];
  if (!row) {
    // Fall back to the earliest rate after the date, so a newly-configured rate still works for backdated entries.
    const later = await db.select().from(r).where(and(
      eq(r.userId, userId),
      or(and(eq(r.base, from), eq(r.quote, to)), and(eq(r.base, to), eq(r.quote, from))),
    )).orderBy(r.effectiveDate).limit(1);
    row = later[0];
  }
  if (!row) return null;
  const rate = normalizeRate(row.rate);
  return row.base === from ? rate : invertRate(rate);
}

export function normalizeRate(rate: string) {
  return rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
}

/** Cache of rates per request, to avoid N queries when converting many rows. */
export function rateCache(db: Exec, userId: string) {
  const m = new Map<string, Promise<string | null>>();
  return (from: string, to: string, date: string) => {
    const k = `${from}>${to}@${date}`;
    let p = m.get(k);
    if (!p) {
      p = findRate(db, userId, from, to, date);
      m.set(k, p);
    }
    return p;
  };
}
