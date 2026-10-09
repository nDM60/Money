import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { schema } from "../db";
import { TX_SHAPE, type TxType } from "@/lib/domain";
import { convertMinor, pctChange } from "@/lib/money";
import {
  addDays, addMonths, bucketFor, bucketKey, bucketKeys, endOfMonth, previousRange, rangeFor, startOfMonth, startOfWeek,
  type Bucket, type DateRange, type Period,
} from "@/lib/dates";
import type { Exec } from "./common";
import { accountBalances, accountGroup } from "./accounts";
import { getSettings, rateCache } from "./settings";

export interface FlowFilters {
  accountId?: string;
  categoryId?: string;
}

interface Flow {
  id: string;
  type: TxType;
  localDate: string;
  categoryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  amount: number;
  currency: string;
  reportingAmount: number;
  reportingCurrency: string;
  description: string;
  merchant: string | null;
  /** Value in the user's current primary currency (null if no rate is configured). */
  value: number | null;
}

/** Load non-deleted transactions in a date range, valued in the primary currency. */
export async function loadFlows(db: Exec, userId: string, range: DateRange, f: FlowFilters = {}): Promise<{ flows: Flow[]; missing: string[] }> {
  const t = schema.transactions;
  const settings = await getSettings(userId, db);
  const primary = settings.primaryCurrency;
  const rows = await db.select({
    id: t.id, type: t.type, localDate: t.localDate, categoryId: t.categoryId, fromAccountId: t.fromAccountId, toAccountId: t.toAccountId,
    amount: t.amount, currency: t.currency, reportingAmount: t.reportingAmount, reportingCurrency: t.reportingCurrency,
    description: t.description, merchant: t.merchant,
  }).from(t).where(and(
    eq(t.userId, userId), isNull(t.deletedAt), gte(t.localDate, range.start), lte(t.localDate, range.end),
    f.categoryId ? eq(t.categoryId, f.categoryId) : undefined,
    f.accountId ? sql`(${t.fromAccountId} = ${f.accountId} or ${t.toAccountId} = ${f.accountId})` : undefined,
  ));
  const rate = rateCache(db, userId);
  const missing = new Set<string>();
  const flows: Flow[] = [];
  for (const r of rows) {
    let value: number | null;
    if (r.reportingCurrency === primary) value = r.reportingAmount;
    else if (r.currency === primary) value = r.amount;
    else {
      const rt = await rate(r.currency, primary, r.localDate);
      if (rt) value = convertMinor(r.amount, r.currency, primary, rt);
      else {
        value = null;
        missing.add(`${r.currency}>${primary}`);
      }
    }
    flows.push({ ...r, type: r.type as TxType, value });
  }
  return { flows, missing: [...missing] };
}

function kindOf(f: Flow): "income" | "expense" | "internal" | "other" {
  const rep = TX_SHAPE[f.type]?.report;
  if (rep === "income") return "income";
  if (rep === "expense") return "expense";
  if (rep === "internal") return "internal";
  return "other";
}

export interface Totals {
  income: number;
  expense: number;
  net: number;
  count: number;
  savingsContributions: number;
  adjustments: number;
  realizedGains: number;
}

export function totalsOf(flows: Flow[], savingsAccountIds: Set<string>): Totals {
  const t: Totals = { income: 0, expense: 0, net: 0, count: 0, savingsContributions: 0, adjustments: 0, realizedGains: 0 };
  for (const f of flows) {
    const v = f.value ?? 0;
    const k = kindOf(f);
    if (f.type !== "valuation") t.count++;
    if (k === "income") t.income += v;
    else if (k === "expense") t.expense += v;
    else if (k === "internal") {
      const intoSavings = f.toAccountId && savingsAccountIds.has(f.toAccountId) && !(f.fromAccountId && savingsAccountIds.has(f.fromAccountId));
      const outOfSavings = f.fromAccountId && savingsAccountIds.has(f.fromAccountId) && !(f.toAccountId && savingsAccountIds.has(f.toAccountId));
      if (intoSavings) t.savingsContributions += v;
      if (outOfSavings) t.savingsContributions -= v;
    } else if (f.type === "adjustment") t.adjustments += f.toAccountId ? v : -v;
    else if (f.type === "valuation") t.realizedGains += f.toAccountId ? v : -v;
  }
  t.net = t.income - t.expense;
  return t;
}

export function seriesOf(flows: Flow[], range: DateRange, bucket: Bucket) {
  const keys = bucketKeys(range, bucket);
  const m = new Map(keys.map((k) => [k, { key: k, income: 0, expense: 0 }]));
  for (const f of flows) {
    const k = kindOf(f);
    if (k !== "income" && k !== "expense") continue;
    const b = m.get(bucketKey(f.localDate, bucket));
    if (b) b[k] += f.value ?? 0;
  }
  return [...m.values()].map((b) => ({ ...b, net: b.income - b.expense }));
}

export async function categoryBreakdown(db: Exec, userId: string, flows: Flow[], kind: "expense" | "income" = "expense") {
  const cats = await db.select().from(schema.categories).where(eq(schema.categories.userId, userId));
  const byId = new Map(cats.map((c) => [c.id, c]));
  const m = new Map<string, number>();
  for (const f of flows) {
    if (kindOf(f) !== kind) continue;
    const key = f.categoryId ?? "uncategorized";
    m.set(key, (m.get(key) ?? 0) + (f.value ?? 0));
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()]
    .map(([id, amount]) => {
      const c = byId.get(id);
      return { id, name: c?.name ?? null, systemKey: c?.systemKey ?? null, color: c?.color ?? "#94a3b8", icon: c?.icon ?? "circle", amount, share: total ? amount / total : 0 };
    })
    .sort((a, b) => b.amount - a.amount);
}

/** Current balances, converted to the primary currency, grouped for the dashboard. */
export async function balanceOverview(db: Exec, userId: string, asOf: string) {
  const settings = await getSettings(userId, db);
  const primary = settings.primaryCurrency;
  const accs = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
  const bal = await accountBalances(db, userId);
  const rate = rateCache(db, userId);
  const missing = new Set<string>();
  const groups = { cash: 0, bank: 0, savings: 0, investment: 0, liability: 0, other: 0 };
  const accounts = [];
  for (const a of accs) {
    const b = bal.get(a.id) ?? 0;
    let converted: number | null = b;
    if (a.currency !== primary) {
      const rt = await rate(a.currency, primary, asOf);
      converted = rt ? convertMinor(b, a.currency, primary, rt) : null;
      if (!rt) missing.add(`${a.currency}>${primary}`);
    }
    accounts.push({ id: a.id, name: a.name, type: a.type, color: a.color, icon: a.icon, currency: a.currency, status: a.status, balance: b, converted });
    if (converted === null || (a.status === "archived" && b === 0)) continue;
    const g = accountGroup(a.type);
    if (g === "cash") {
      if (a.type === "bank") groups.bank += converted;
      else groups.cash += converted;
    } else groups[g] += converted;
  }
  // Unrealized gains on holdings that have a market valuation.
  const hs = await db.select().from(schema.holdings).where(eq(schema.holdings.userId, userId));
  let unrealized = 0;
  for (const h of hs) {
    if (h.marketValue === null) continue;
    const acc = accs.find((a) => a.id === h.accountId);
    if (!acc) continue;
    let gain = h.marketValue - h.costBasis;
    if (acc.currency !== primary) {
      const rt = await rate(acc.currency, primary, asOf);
      if (!rt) continue;
      gain = convertMinor(gain, acc.currency, primary, rt);
    }
    unrealized += gain;
  }
  const availableCash = groups.cash + groups.bank;
  const investmentValue = groups.investment + unrealized;
  const netWorth = availableCash + groups.savings + investmentValue + groups.liability + groups.other;
  return { primary, accounts, groups, unrealized, availableCash, investmentValue, netWorth, missing: [...missing] };
}

/**
 * Balance history (book value) at the end of each bucket, overall and per group.
 * Built from the balance at range start plus daily account movements.
 */
export async function balanceSeries(db: Exec, userId: string, range: DateRange, bucket: Bucket) {
  const settings = await getSettings(userId, db);
  const primary = settings.primaryCurrency;
  const accs = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
  const start = await accountBalances(db, userId, addDays(range.start, -1));
  const t = schema.transactions;
  const a = schema.accounts;
  const deltas = await db.execute(sql`
    select acc_id, d, sum(v)::bigint as v from (
      select ${t.toAccountId} as acc_id, ${t.localDate} as d, ${t.toAmount} as v from ${t}
        join ${a} on ${a.id} = ${t.toAccountId}
        where ${t.userId} = ${userId} and ${t.deletedAt} is null and ${t.localDate} between ${range.start} and ${range.end} and ${t.localDate} >= ${a.openingDate}
      union all
      select ${t.fromAccountId}, ${t.localDate}, -${t.fromAmount} from ${t}
        join ${a} on ${a.id} = ${t.fromAccountId}
        where ${t.userId} = ${userId} and ${t.deletedAt} is null and ${t.localDate} between ${range.start} and ${range.end} and ${t.localDate} >= ${a.openingDate}
    ) x group by acc_id, d`);
  const byDate = new Map<string, { acc: string; v: number }[]>();
  const push = (d: string, acc: string, v: number) => {
    const l = byDate.get(d) ?? [];
    l.push({ acc, v });
    byDate.set(d, l);
  };
  for (const r of (deltas as unknown as { rows: { acc_id: string; d: string | Date; v: string | number }[] }).rows) {
    const d = typeof r.d === "string" ? r.d.slice(0, 10) : r.d.toISOString().slice(0, 10);
    push(d, r.acc_id, Number(r.v));
  }
  for (const acc of accs) {
    if (acc.openingDate >= range.start && acc.openingDate <= range.end) push(acc.openingDate, acc.id, acc.openingBalance);
  }
  const cur = new Map(accs.map((x) => [x.id, start.get(x.id) ?? 0]));
  const rate = rateCache(db, userId);
  const keys = bucketKeys(range, bucket);
  const out: { key: string; end: string; total: number; savings: number; investment: number; cash: number }[] = [];
  let day = range.start;
  for (const k of keys) {
    let end = bucket === "day" ? k : bucket === "week" ? addDays(k, 6) : endOfMonth(k + "-01");
    if (end > range.end) end = range.end;
    while (day <= end) {
      for (const { acc, v } of byDate.get(day) ?? []) cur.set(acc, (cur.get(acc) ?? 0) + v);
      day = addDays(day, 1);
    }
    const p = { key: k, end, total: 0, savings: 0, investment: 0, cash: 0 };
    for (const acc of accs) {
      let v = cur.get(acc.id) ?? 0;
      if (acc.currency !== primary && v !== 0) {
        const rt = await rate(acc.currency, primary, end);
        if (!rt) continue;
        v = convertMinor(v, acc.currency, primary, rt);
      }
      const g = accountGroup(acc.type);
      p.total += v;
      if (g === "savings") p.savings += v;
      else if (g === "investment") p.investment += v;
      else if (g === "cash") p.cash += v;
    }
    out.push(p);
  }
  return out;
}

export async function savingsAccountIds(db: Exec, userId: string) {
  const rows = await db.select({ id: schema.accounts.id }).from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), inArray(schema.accounts.type, ["savings", "investment"])));
  return new Set(rows.map((r) => r.id));
}

// ---------- budgets ----------

export function budgetWindow(period: string, today: string): DateRange {
  switch (period) {
    case "daily": return { start: today, end: today };
    case "weekly": return { start: startOfWeek(today), end: addDays(startOfWeek(today), 6) };
    case "yearly": return { start: today.slice(0, 4) + "-01-01", end: today.slice(0, 4) + "-12-31" };
    default: return { start: startOfMonth(today), end: endOfMonth(today) };
  }
}

function prevWindow(period: string, w: DateRange): DateRange {
  switch (period) {
    case "daily": return { start: addDays(w.start, -1), end: addDays(w.start, -1) };
    case "weekly": return { start: addDays(w.start, -7), end: addDays(w.start, -1) };
    case "yearly": { const y = +w.start.slice(0, 4) - 1; return { start: `${y}-01-01`, end: `${y}-12-31` }; }
    default: { const s = addMonths(w.start, -1); return { start: s, end: endOfMonth(s) }; }
  }
}

export async function budgetStatus(db: Exec, userId: string, today: string) {
  const settings = await getSettings(userId, db);
  const primary = settings.primaryCurrency;
  const budgets = await db.select().from(schema.budgets).where(and(eq(schema.budgets.userId, userId), eq(schema.budgets.active, true)));
  const rate = rateCache(db, userId);
  const out = [];
  for (const b of budgets) {
    const w = budgetWindow(b.period, today);
    const spentIn = async (r: DateRange) => {
      const { flows } = await loadFlows(db, userId, r, { categoryId: b.categoryId ?? undefined });
      return flows.filter((f) => kindOf(f) === "expense").reduce((s, f) => s + (f.value ?? 0), 0);
    };
    let limit = b.amount;
    if (b.currency !== primary) {
      const rt = await rate(b.currency, primary, today);
      if (!rt) continue;
      limit = convertMinor(b.amount, b.currency, primary, rt);
    }
    const spent = await spentIn(w);
    let carried = 0;
    if (b.rollover) {
      const pw = prevWindow(b.period, w);
      if (pw.end >= b.startDate) carried = Math.max(0, limit - (await spentIn(pw)));
    }
    const available = limit + carried;
    out.push({
      id: b.id, categoryId: b.categoryId, period: b.period, amount: b.amount, currency: b.currency, rollover: b.rollover,
      thresholds: b.thresholds, limit, carried, available, spent, remaining: available - spent,
      ratio: available > 0 ? spent / available : spent > 0 ? Infinity : 0, window: w,
    });
  }
  return out;
}

// ---------- dashboard ----------

export async function dashboard(db: Exec, userId: string, p: { period: Period; today: string; start?: string; end?: string } & FlowFilters) {
  const range = rangeFor(p.period, p.today, { start: p.start, end: p.end });
  const prev = previousRange(p.period, range);
  const bucket = bucketFor(range);
  const filters = { accountId: p.accountId, categoryId: p.categoryId };
  const savingsIds = await savingsAccountIds(db, userId);
  const [cur, before, todayFlows, monthFlows] = await Promise.all([
    loadFlows(db, userId, range, filters),
    loadFlows(db, userId, prev, filters),
    loadFlows(db, userId, { start: p.today, end: p.today }),
    loadFlows(db, userId, rangeFor("month", p.today)),
  ]);
  const totals = totalsOf(cur.flows, savingsIds);
  const prevTotals = totalsOf(before.flows, savingsIds);
  const overview = await balanceOverview(db, userId, p.today);
  const budgets = await budgetStatus(db, userId, p.today);
  const overall = budgets.find((b) => !b.categoryId && b.period === "monthly");
  const monthTotals = totalsOf(monthFlows.flows, savingsIds);
  const todayTotals = totalsOf(todayFlows.flows, savingsIds);
  // Charts stop at today: future days have no data yet and would read as a drop to zero.
  const chartRange = range.start <= p.today && range.end > p.today ? { start: range.start, end: p.today } : range;
  const series = seriesOf(cur.flows, chartRange, bucket);
  const balances = await balanceSeries(db, userId, chartRange, bucket);
  const categories = await categoryBreakdown(db, userId, cur.flows);
  // Spending trend by day of the selected range (capped to 62 days for readability).
  const dailyRange = bucket === "day" ? chartRange : { start: addDays(chartRange.end, -29), end: chartRange.end };
  const dailyFlows = bucket === "day" ? cur.flows : (await loadFlows(db, userId, dailyRange, filters)).flows;
  const daily = seriesOf(dailyFlows, dailyRange, "day");
  return {
    range, prev, bucket, period: p.period, today: p.today, currency: overview.primary,
    totals, prevTotals,
    change: {
      income: pctChange(totals.income, prevTotals.income),
      expense: pctChange(totals.expense, prevTotals.expense),
    },
    overview: {
      netWorth: overview.netWorth,
      availableCash: overview.availableCash,
      cash: overview.groups.cash,
      bank: overview.groups.bank,
      savings: overview.groups.savings,
      investments: overview.investmentValue,
      liabilities: overview.groups.liability,
      unrealized: overview.unrealized,
      todayIncome: todayTotals.income,
      todayExpense: todayTotals.expense,
      monthIncome: monthTotals.income,
      monthExpense: monthTotals.expense,
      remainingBudget: overall ? overall.remaining : null,
    },
    accounts: overview.accounts,
    series, daily, balances, categories, budgets,
    missingRates: [...new Set([...cur.missing, ...overview.missing])],
  };
}

/** Category spending this month vs average of previous 3 months; flags big increases. */
export async function unusualCategories(db: Exec, userId: string, today: string) {
  const cur = rangeFor("month", today);
  const { flows } = await loadFlows(db, userId, { start: addMonths(cur.start, -3), end: cur.end });
  const now = new Map<string, number>();
  const past = new Map<string, number>();
  for (const f of flows) {
    if (kindOf(f) !== "expense" || !f.categoryId) continue;
    const m = f.localDate >= cur.start ? now : past;
    m.set(f.categoryId, (m.get(f.categoryId) ?? 0) + (f.value ?? 0));
  }
  // Average only over previous months that actually have recorded expenses.
  const months = new Set(flows.filter((f) => kindOf(f) === "expense" && f.localDate < cur.start).map((f) => f.localDate.slice(0, 7))).size;
  const out: { categoryId: string; current: number; average: number; change: number }[] = [];
  if (months === 0) return out;
  for (const [id, v] of now) {
    const avg = Math.round((past.get(id) ?? 0) / months);
    const ch = pctChange(v, avg);
    if (avg > 0 && ch !== null && ch >= 50) out.push({ categoryId: id, current: v, average: avg, change: ch });
  }
  return out.sort((a, b) => b.change - a.change);
}

export { kindOf };
