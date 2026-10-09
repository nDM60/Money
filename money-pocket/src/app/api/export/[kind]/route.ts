import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { notFound, route } from "@/server/http";
import { csvResponse } from "@/server/csv";
import { buildSheetData } from "@/server/services/sheets";
import { userToday } from "@/server/services/settings";
import { categoryBreakdown, loadFlows } from "@/server/services/reports";
import { isDateStr, rangeFor } from "@/lib/dates";
import { toDecimalString } from "@/lib/money";
import { getSettings } from "@/server/services/settings";

/** CSV / JSON exports generated from the database (same data as the Google Sheets mirror). */
export const GET = route<{ kind: string }>(async ({ user, params, query }) => {
  const db = await getDb();
  const today = await userToday(user.id, db);
  const stamp = today.replace(/-/g, "");
  if (params.kind === "json") {
    const data = await buildSheetData(db, user.id);
    const u = schema.users;
    const [profile] = await db.select({ email: u.email, name: u.name, createdAt: u.createdAt }).from(u).where(eq(u.id, user.id));
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    const goals = await db.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.userId, user.id));
    const holdings = await db.select().from(schema.holdings).where(eq(schema.holdings.userId, user.id));
    const recurring = await db.select().from(schema.recurringRules).where(eq(schema.recurringRules.userId, user.id));
    const rates = await db.select().from(schema.exchangeRates).where(eq(schema.exchangeRates.userId, user.id));
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), profile, sheets: data, goals, holdings, recurring, exchangeRates: rates, notifications: notes }, null, 2);
    return new Response(body, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="money-pocket-${stamp}.json"`, "cache-control": "no-store" } });
  }
  const sheetFor: Record<string, string> = {
    "transactions.csv": "Transactions", "accounts.csv": "Accounts", "budgets.csv": "Budgets", "categories.csv": "Categories",
    "monthly.csv": "Monthly Summary", "snapshots.csv": "Balance Snapshots",
  };
  if (sheetFor[params.kind]) {
    const data = await buildSheetData(db, user.id);
    let rows = data[sheetFor[params.kind]];
    const start = query.get("start");
    const end = query.get("end");
    if (params.kind === "transactions.csv" && (isDateStr(start) || isDateStr(end))) {
      rows = [rows[0], ...rows.slice(1).filter((r) => (!isDateStr(start) || String(r[1]) >= start) && (!isDateStr(end) || String(r[1]) <= end))];
    }
    return csvResponse(`money-pocket-${params.kind.replace(".csv", "")}-${stamp}.csv`, rows);
  }
  if (params.kind === "categories-report.csv") {
    const s = await getSettings(user.id, db);
    const st = query.get("start");
    const en = query.get("end");
    const range = isDateStr(st) && isDateStr(en) ? { start: st, end: en } : rangeFor("month", today);
    const { flows } = await loadFlows(db, user.id, range);
    const cats = await categoryBreakdown(db, user.id, flows);
    return csvResponse(`money-pocket-categories-${range.start}-${range.end}.csv`, [
      ["category", `amount_${s.primaryCurrency}`, "share_percent"],
      ...cats.map((c) => [c.name ?? "Uncategorized", toDecimalString(c.amount, s.primaryCurrency), (c.share * 100).toFixed(1)]),
    ]);
  }
  throw notFound();
});
