import { and, eq } from "drizzle-orm";
import { schema } from "../db";
import { addDays, diffDays, previousRange, rangeFor, type DateRange } from "@/lib/dates";
import { pctChange } from "@/lib/money";
import type { Exec } from "./common";
import {
  balanceSeries, budgetStatus, categoryBreakdown, kindOf, loadFlows, savingsAccountIds, seriesOf, totalsOf,
} from "./reports";
import { accountBalances } from "./accounts";
import { getSettings } from "./settings";

export type SummaryKind = "daily" | "weekly" | "monthly" | "yearly";

const PERIOD_OF = { daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const;

export interface Suggestion {
  key: "cut_top_category" | "spending_exceeds_income" | "over_budget" | "review_uncategorized" | "keep_saving" | "set_budget";
  vars?: Record<string, string | number>;
}

/** Build a summary purely from stored transactions and balances. */
export async function buildSummary(db: Exec, userId: string, kind: SummaryKind, anchor: string) {
  const settings = await getSettings(userId, db);
  const period = PERIOD_OF[kind];
  const range = rangeFor(period, anchor);
  // Never summarize future days.
  const effectiveEnd = range.end > anchor ? anchor : range.end;
  const prev = previousRange(period, range);
  const savingsIds = await savingsAccountIds(db, userId);
  const cur = await loadFlows(db, userId, range);
  const before = await loadFlows(db, userId, prev);
  const totals = totalsOf(cur.flows, savingsIds);
  const prevTotals = totalsOf(before.flows, savingsIds);
  const categories = await categoryBreakdown(db, userId, cur.flows);
  const days = diffDays(range.start, effectiveEnd) + 1;
  const budgets = (await budgetStatus(db, userId, anchor)).filter((b) => b.period === kind || kind === "yearly" || (kind === "monthly" && b.period === "monthly"));
  const uncategorized = cur.flows.filter((f) => !f.categoryId && (kindOf(f) === "income" || kindOf(f) === "expense")).length;

  const base = {
    kind, range, anchor, currency: settings.primaryCurrency, totals, prevTotals,
    change: { income: pctChange(totals.income, prevTotals.income), expense: pctChange(totals.expense, prevTotals.expense) },
    topCategories: categories.slice(0, 5),
    categories,
    budgets,
    count: totals.count,
    uncategorized,
    avgDailyExpense: days > 0 ? Math.round(totals.expense / days) : 0,
    savingsRate: totals.income > 0 ? Math.round(((totals.income - totals.expense) / totals.income) * 100) : null,
    missingRates: cur.missing,
  };

  const suggestions: Suggestion[] = [];
  const top = categories[0];
  if (top && totals.expense > 0 && top.share >= 0.4) suggestions.push({ key: "cut_top_category", vars: { share: Math.round(top.share * 100) } });
  if (totals.expense > totals.income && totals.income > 0) suggestions.push({ key: "spending_exceeds_income" });
  const over = budgets.filter((b) => b.remaining < 0).length;
  if (over > 0) suggestions.push({ key: "over_budget", vars: { count: over } });
  if (uncategorized > 0) suggestions.push({ key: "review_uncategorized", vars: { count: uncategorized } });
  if (budgets.length === 0 && totals.expense > 0) suggestions.push({ key: "set_budget" });
  if (totals.savingsContributions > 0) suggestions.push({ key: "keep_saving" });

  if (kind === "daily") {
    // Unusual: an expense larger than 3x the average expense of the previous 90 days.
    const hist = await loadFlows(db, userId, { start: addDays(anchor, -90), end: addDays(anchor, -1) });
    const past = hist.flows.filter((f) => kindOf(f) === "expense").map((f) => f.value ?? 0);
    const avg = past.length >= 5 ? past.reduce((a, b) => a + b, 0) / past.length : null;
    const unusual = avg ? cur.flows.filter((f) => kindOf(f) === "expense" && (f.value ?? 0) > avg * 3) : [];
    const balToday = await accountBalances(db, userId, anchor);
    const balYesterday = await accountBalances(db, userId, addDays(anchor, -1));
    const accs = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
    const accountChanges = accs
      .map((a) => ({ id: a.id, name: a.name, currency: a.currency, change: (balToday.get(a.id) ?? 0) - (balYesterday.get(a.id) ?? 0), balance: balToday.get(a.id) ?? 0 }))
      .filter((a) => a.change !== 0);
    const dailyBudget = budgets.find((b) => b.period === "daily" && !b.categoryId);
    return {
      ...base, suggestions,
      transactions: cur.flows.filter((f) => f.type !== "valuation").map((f) => ({ id: f.id, type: f.type, value: f.value, description: f.description, merchant: f.merchant, categoryId: f.categoryId })),
      unusual: unusual.map((f) => ({ id: f.id, value: f.value, description: f.description, merchant: f.merchant })),
      accountChanges,
      remainingDailyBudget: dailyBudget ? dailyBudget.remaining : null,
    };
  }

  if (kind === "weekly") {
    return { ...base, suggestions, series: seriesOf(cur.flows, range, "day") };
  }

  if (kind === "monthly") {
    const startBal = await accountBalances(db, userId, addDays(range.start, -1));
    const endBal = await accountBalances(db, userId, effectiveEnd);
    const accs = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
    const accountChanges = accs.map((a) => ({
      id: a.id, name: a.name, currency: a.currency, start: startBal.get(a.id) ?? 0, end: endBal.get(a.id) ?? 0,
      change: (endBal.get(a.id) ?? 0) - (startBal.get(a.id) ?? 0),
    })).filter((a) => a.start !== 0 || a.end !== 0);
    const nw = await balanceSeries(db, userId, { start: range.start, end: effectiveEnd }, "month");
    const nwStart = (await balanceSeries(db, userId, { start: addDays(range.start, -1), end: addDays(range.start, -1) }, "day"))[0]?.total ?? 0;
    const nwEnd = nw[nw.length - 1]?.total ?? nwStart;
    const r = schema.recurringRules;
    const bills = await db.select().from(r).where(and(eq(r.userId, userId), eq(r.active, true), eq(r.type, "expense")));
    const prevMonthDays: DateRange = prev;
    return {
      ...base, suggestions,
      series: seriesOf(cur.flows, range, "day"),
      accountChanges,
      netWorth: { start: nwStart, end: nwEnd, change: nwEnd - nwStart },
      recurringBills: bills.map((b) => ({ id: b.id, name: b.name, amount: b.amount, currency: b.currency, nextDueDate: b.nextDueDate, frequency: b.frequency })),
      previous: { range: prevMonthDays, totals: prevTotals },
    };
  }

  // yearly
  const monthly = seriesOf(cur.flows, range, "month");
  const nwHistory = await balanceSeries(db, userId, { start: range.start, end: effectiveEnd }, "month");
  const goals = await db.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.userId, userId));
  const milestones: { key: "best_month" | "positive_months" | "goal_completed" | "net_worth_high"; vars: Record<string, string | number> }[] = [];
  const withData = monthly.filter((m) => m.income || m.expense);
  if (withData.length) {
    const best = withData.reduce((a, b) => (b.net > a.net ? b : a));
    if (best.net > 0) milestones.push({ key: "best_month", vars: { month: best.key, net: best.net } });
    milestones.push({ key: "positive_months", vars: { count: withData.filter((m) => m.net > 0).length, total: withData.length } });
  }
  for (const g of goals) {
    if (g.completedAt && g.completedAt.toISOString().slice(0, 4) === range.start.slice(0, 4)) milestones.push({ key: "goal_completed", vars: { name: g.name } });
  }
  if (nwHistory.length) {
    const hi = nwHistory.reduce((a, b) => (b.total > a.total ? b : a));
    milestones.push({ key: "net_worth_high", vars: { month: hi.key, value: hi.total } });
  }
  // Monthly overall budget performance: months where spending stayed within the monthly overall budget.
  const overall = (await db.select().from(schema.budgets).where(and(eq(schema.budgets.userId, userId), eq(schema.budgets.period, "monthly"), eq(schema.budgets.active, true))))
    .find((b) => !b.categoryId);
  const budgetMonths = overall
    ? monthly.filter((m) => m.key + "-01" <= effectiveEnd).map((m) => ({ month: m.key, spent: m.expense, limit: overall.amount, within: m.expense <= overall.amount }))
    : [];
  return { ...base, suggestions, monthly, netWorthHistory: nwHistory, milestones, budgetMonths };
}

