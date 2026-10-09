import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { addDays, addMonths, localTimeOf, startOfMonth, startOfWeek, todayIn, weekday } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { categoryLabel } from "@/lib/i18n/categories";
import { translate } from "@/lib/i18n";
import type { Lang } from "@/lib/domain";
import type { Exec } from "./common";
import { checkBudgetAlerts, notify } from "./notifications";
import { autoPostDue, listRecurring } from "./recurring";
import { buildSummary } from "./summaries";
import { listGoals } from "./goals";
import { getSettings } from "./settings";
import { purgeExpiredSessions } from "../auth";

/**
 * One scheduler pass. Safe to run as often as every minute: every
 * notification is deduplicated per user and period.
 */
export async function runTick(now: Date = new Date()) {
  const db = await getDb();
  const users = await db.select({ id: schema.users.id }).from(schema.users);
  let sent = 0;
  let posted = 0;
  const errors: string[] = [];
  for (const u of users) {
    try {
      const r = await tickUser(db, u.id, now);
      sent += r.sent;
      posted += r.posted;
    } catch (e) {
      console.error("tick failed for user", u.id, e);
      errors.push(u.id);
    }
  }
  await purgeExpiredSessions().catch(() => {});
  const state = { at: now.toISOString(), users: users.length, sent, posted, errors: errors.length };
  await db.insert(schema.systemState).values({ key: "scheduler", value: state })
    .onConflictDoUpdate({ target: schema.systemState.key, set: { value: state, updatedAt: new Date() } });
  // Retry spreadsheet syncs that are pending or failed.
  try {
    const { syncDirtyIntegrations } = await import("./sheets");
    await syncDirtyIntegrations();
  } catch (e) {
    console.error("sheet sync pass failed", e);
  }
  return state;
}

export async function tickUser(db: Exec, userId: string, now: Date) {
  const s = await getSettings(userId, db);
  const lang = s.language as Lang;
  const today = todayIn(s.timezone, now);
  const time = localTimeOf(now, s.timezone);
  const money = (v: number) => formatMoney(v, s.primaryCurrency, lang);
  let sent = 0;
  const count = (n: unknown) => { if (n) sent++; };

  const posted = await autoPostDue(db, userId, today);
  await checkBudgetAlerts(db, userId);
  await listGoals(db, userId); // marks completed goals and notifies

  if (s.notifyBills) {
    for (const r of await listRecurring(db, userId)) {
      if (r.status === "upcoming" || r.status === "due") {
        count(await notify(db, userId, { kind: "bill_due", dedupeKey: `bill:${r.id}:${r.nextDueDate}`, vars: { name: r.name, amount: formatMoney(r.amount, r.currency, lang), date: r.nextDueDate }, data: { url: "/recurring" } }));
      } else if (r.status === "overdue") {
        count(await notify(db, userId, { kind: "bill_overdue", dedupeKey: `bill_overdue:${r.id}:${r.nextDueDate}`, vars: { name: r.name, amount: formatMoney(r.amount, r.currency, lang), date: r.nextDueDate }, data: { url: "/recurring" } }));
      }
    }
  }

  if (time >= s.reminderTime) {
    if (s.notifyDaily) {
      const d = await buildSummary(db, userId, "daily", today);
      const top = d.topCategories[0];
      count(await notify(db, userId, {
        kind: "daily_summary",
        dedupeKey: `daily:${today}`,
        vars: {
          expense: money(d.totals.expense),
          income: money(d.totals.income),
          net: formatMoney(d.totals.net, s.primaryCurrency, lang, { sign: true }),
          top: top ? (top.name ? categoryLabel({ name: top.name, systemKey: top.systemKey }, lang) : translate(lang, "common.uncategorized")) : "—",
          count: d.count,
        },
        data: { url: "/reports?tab=daily" },
      }));
    }
    if (s.notifyUncategorized) {
      const t = schema.transactions;
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(sql`${t.userId} = ${userId} and ${t.deletedAt} is null and ${t.categoryId} is null and ${t.type} in ('income','expense','refund') and ${t.localDate} >= ${addDays(today, -30)}`);
      if (Number(n) > 0) count(await notify(db, userId, { kind: "uncategorized", dedupeKey: `uncat:${today}`, vars: { count: Number(n) }, data: { url: "/transactions?uncategorized=1" } }));
    }
    if (s.notifyWeekly && weekday(today) === 0) {
      const lastWeek = addDays(startOfWeek(today), -7);
      const w = await buildSummary(db, userId, "weekly", addDays(lastWeek, 6));
      count(await notify(db, userId, { kind: "weekly_report", dedupeKey: `weekly:${lastWeek}`, vars: { expense: money(w.totals.expense), income: money(w.totals.income), avg: money(w.avgDailyExpense) }, data: { url: "/reports?tab=weekly" } }));
    }
    if (s.notifyMonthly && today.slice(8, 10) === "01") {
      const lastMonth = addMonths(startOfMonth(today), -1);
      const m = await buildSummary(db, userId, "monthly", addDays(startOfMonth(today), -1));
      count(await notify(db, userId, {
        kind: "monthly_report", dedupeKey: `monthly:${lastMonth.slice(0, 7)}`,
        vars: { month: lastMonth.slice(0, 7), expense: money(m.totals.expense), income: money(m.totals.income), rate: m.savingsRate ?? 0 },
        data: { url: "/reports?tab=monthly" },
      }));
    }
  }
  return { sent, posted };
}

export async function schedulerState() {
  const db = await getDb();
  const [row] = await db.select().from(schema.systemState).where(eq(schema.systemState.key, "scheduler"));
  return (row?.value as { at: string; users: number; sent: number } | undefined) ?? null;
}
