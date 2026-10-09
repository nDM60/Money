import { and, eq } from "drizzle-orm";
import { schema } from "../db";
import type { UiBlock } from "@/lib/chat-types";
import { ACCOUNT_TYPES, BUDGET_PERIODS, DEFAULT_CATEGORIES, USER_TX_TYPES, type Lang } from "@/lib/domain";
import { CURRENCY_CODES, formatMoney, parseAmount, pctChange } from "@/lib/money";
import { isDateStr, previousRange, rangeFor, type DateRange, type Period } from "@/lib/dates";
import { categoryLabel } from "@/lib/i18n/categories";
import type { Exec } from "./common";
import { balanceOverview, budgetStatus, categoryBreakdown, loadFlows, savingsAccountIds, seriesOf, totalsOf } from "./reports";
import { listTransactions } from "./transactions";
import { listGoals } from "./goals";
import type { Settings } from "./settings";

/**
 * The only operations the assistant can perform. Read tools query the
 * authenticated user's own data; "prepare_*" tools never change data — they
 * return a prefilled form the user must review and confirm in the app.
 */
export interface ToolResult {
  data: unknown;
  ui: UiBlock[];
}

export interface ToolContext {
  db: Exec;
  userId: string;
  settings: Settings;
  today: string;
}

export const TOOL_DEFS = [
  {
    name: "get_period_summary",
    description: "Income, expenses, net cash flow, transaction count and top spending categories for a period, computed from the user's recorded transactions. Internal transfers are excluded.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["day", "week", "month", "year", "custom"], description: "Calendar period containing anchor_date (default today), or custom with start/end" },
        anchor_date: { type: "string", description: "YYYY-MM-DD inside the wanted period, e.g. 2026-09-15 for September 2026" },
        start: { type: "string", description: "YYYY-MM-DD, only for custom" },
        end: { type: "string", description: "YYYY-MM-DD, only for custom" },
      },
      required: ["period"],
    },
  },
  {
    name: "compare_periods",
    description: "Compare income and expenses of the period containing anchor_date with the previous equivalent period (e.g. this month vs last month).",
    input_schema: {
      type: "object" as const,
      properties: { period: { type: "string", enum: ["day", "week", "month", "year"] }, anchor_date: { type: "string" } },
      required: ["period"],
    },
  },
  {
    name: "get_spending_by_category",
    description: "Expense totals by category for a period, largest first.",
    input_schema: {
      type: "object" as const,
      properties: { period: { type: "string", enum: ["day", "week", "month", "year", "custom"] }, anchor_date: { type: "string" }, start: { type: "string" }, end: { type: "string" } },
      required: ["period"],
    },
  },
  {
    name: "get_balances",
    description: "Current balance of every active account, total available cash and net worth.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "find_transactions",
    description: "Search the user's transactions. Amount bounds are in the user's primary currency as decimal strings.",
    input_schema: {
      type: "object" as const,
      properties: {
        min_amount: { type: "string" }, max_amount: { type: "string" },
        start: { type: "string" }, end: { type: "string" },
        type: { type: "string", enum: [...USER_TX_TYPES] },
        query: { type: "string", description: "Text to match in description, merchant, notes or tags" },
        limit: { type: "integer", description: "Max rows, default 20, max 50" },
      },
    },
  },
  {
    name: "get_budget_status",
    description: "Current budgets with spent, available and remaining amounts.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_savings_progress",
    description: "Savings goals with current saved amount, target and progress.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "prepare_transaction",
    description: "Open the Add Transaction form prefilled for the user to review and confirm. Does NOT save anything.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: [...USER_TX_TYPES] },
        amount: { type: "string", description: "Decimal amount, e.g. 50000" },
        currency: { type: "string", enum: [...CURRENCY_CODES] },
        description: { type: "string" },
        category_key: { type: "string", enum: DEFAULT_CATEGORIES.map((c) => c.key) },
        account_name: { type: "string", description: "Name of the account to use, if the user said one" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["type"],
    },
  },
  {
    name: "prepare_account",
    description: "Open the Create Account form prefilled for the user to confirm. Does NOT create anything. An opening balance is existing money, not income.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: [...ACCOUNT_TYPES] },
        currency: { type: "string", enum: [...CURRENCY_CODES] },
        opening_balance: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "prepare_budget",
    description: "Open the Budget form prefilled for the user to confirm. Does NOT create anything.",
    input_schema: {
      type: "object" as const,
      properties: {
        category_key: { type: "string", enum: DEFAULT_CATEGORIES.filter((c) => c.kind === "expense").map((c) => c.key) },
        period: { type: "string", enum: [...BUDGET_PERIODS] },
        amount: { type: "string" },
      },
      required: ["period"],
    },
  },
  {
    name: "open_scanner",
    description: "Open the receipt / banknote scanner.",
    input_schema: { type: "object" as const, properties: { mode: { type: "string", enum: ["receipt", "banknote"] } } },
  },
  {
    name: "show_view",
    description: "Navigate to a screen of the app: accounts, transactions, budgets, savings, investments, reports (with export options), or a monthly expense chart on the dashboard.",
    input_schema: {
      type: "object" as const,
      properties: { view: { type: "string", enum: ["accounts", "transactions", "budgets", "savings", "investments", "reports", "dashboard_month", "settings"] } },
      required: ["view"],
    },
  },
];

function rangeOf(ctx: ToolContext, input: { period?: string; anchor_date?: string; start?: string; end?: string }): { period: Period; range: DateRange } {
  const period = (["day", "week", "month", "year", "custom"].includes(input.period ?? "") ? input.period : "month") as Period;
  const anchor = isDateStr(input.anchor_date) ? input.anchor_date : ctx.today;
  return { period, range: rangeFor(period, anchor, { start: input.start, end: input.end }) };
}

function label(r: DateRange) {
  return r.start === r.end ? r.start : `${r.start} → ${r.end}`;
}

export async function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const { db, userId, settings } = ctx;
  const cur = settings.primaryCurrency;
  const lang = settings.language as Lang;
  const fmt = (v: number, c = cur) => formatMoney(v, c, lang);
  const catName = (c: { name: string | null; systemKey: string | null }) => (c.name ? categoryLabel({ name: c.name, systemKey: c.systemKey }, lang) : "Uncategorized");

  switch (name) {
    case "get_period_summary": {
      const { range } = rangeOf(ctx, input);
      const { flows, missing } = await loadFlows(db, userId, range);
      const tot = totalsOf(flows, await savingsAccountIds(db, userId));
      const cats = await categoryBreakdown(db, userId, flows);
      return {
        data: {
          range, currency: cur, income: fmt(tot.income), expenses: fmt(tot.expense), net: formatMoney(tot.net, cur, lang, { sign: true }),
          transactions: tot.count, top_categories: cats.slice(0, 5).map((c) => ({ name: catName(c), amount: fmt(c.amount), share: Math.round(c.share * 100) + "%" })),
          ...(missing.length ? { warning: `Some transactions could not be converted (missing exchange rate ${missing.join(", ")})` } : {}),
        },
        ui: [{ type: "summary", label: label(range), range, currency: cur, income: tot.income, expense: tot.expense, net: tot.net, count: tot.count, topCategories: cats.slice(0, 5) }],
      };
    }
    case "compare_periods": {
      const { period, range } = rangeOf(ctx, input);
      const p = period === "custom" ? "month" : period;
      const prev = previousRange(p, range);
      const ids = await savingsAccountIds(db, userId);
      const a = totalsOf((await loadFlows(db, userId, range)).flows, ids);
      const b = totalsOf((await loadFlows(db, userId, prev)).flows, ids);
      const change = { income: pctChange(a.income, b.income), expense: pctChange(a.expense, b.expense) };
      return {
        data: {
          current: { range, income: fmt(a.income), expenses: fmt(a.expense) },
          previous: { range: prev, income: fmt(b.income), expenses: fmt(b.expense) },
          expense_change_percent: change.expense, income_change_percent: change.income,
          note: change.expense === null ? "No meaningful baseline for a percentage change" : undefined,
        },
        ui: [{ type: "comparison", label: p, currency: cur, current: { label: label(range), income: a.income, expense: a.expense }, previous: { label: label(prev), income: b.income, expense: b.expense }, change }],
      };
    }
    case "get_spending_by_category": {
      const { range } = rangeOf(ctx, input);
      const { flows } = await loadFlows(db, userId, range);
      const cats = await categoryBreakdown(db, userId, flows);
      return {
        data: { range, currency: cur, categories: cats.map((c) => ({ name: catName(c), amount: fmt(c.amount), share: Math.round(c.share * 100) + "%" })) },
        ui: [{ type: "categories", label: label(range), currency: cur, items: cats }, { type: "cashflow", label: label(range), currency: cur, series: seriesOf(flows, range, range.end.slice(0, 7) === range.start.slice(0, 7) ? "day" : "month") }],
      };
    }
    case "get_balances": {
      const o = await balanceOverview(db, userId, ctx.today);
      const active = o.accounts.filter((a) => a.status === "active");
      return {
        data: {
          net_worth: fmt(o.netWorth), available_cash: fmt(o.availableCash), savings: fmt(o.groups.savings), investments: fmt(o.investmentValue),
          accounts: active.map((a) => ({ name: a.name, type: a.type, balance: fmt(a.balance, a.currency) })),
        },
        ui: [{ type: "accounts", currency: cur, netWorth: o.netWorth, availableCash: o.availableCash, accounts: active.map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: a.balance })) }],
      };
    }
    case "find_transactions": {
      const min = typeof input.min_amount === "string" ? parseAmount(input.min_amount, cur) : null;
      const max = typeof input.max_amount === "string" ? parseAmount(input.max_amount, cur) : null;
      const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
      const res = await listTransactions(db, userId, {
        min: min ?? undefined, max: max ?? undefined,
        start: isDateStr(input.start) ? input.start : undefined, end: isDateStr(input.end) ? input.end : undefined,
        type: typeof input.type === "string" ? input.type : undefined, q: typeof input.query === "string" ? input.query.slice(0, 100) : undefined,
        sort: "date_desc", page: 1, pageSize: limit,
      });
      const items = res.items.map((t) => ({ id: t.id, date: t.localDate, type: t.type, amount: t.amount, currency: t.currency, description: t.description, merchant: t.merchant }));
      return {
        data: { total_matches: res.total, shown: items.length, transactions: items.map((t) => ({ date: t.date, type: t.type, amount: fmt(t.amount, t.currency), description: t.description, merchant: t.merchant })) },
        ui: [{ type: "transactions", label: "", items, total: res.total }],
      };
    }
    case "get_budget_status": {
      const st = await budgetStatus(db, userId, ctx.today);
      const cats = await db.select().from(schema.categories).where(eq(schema.categories.userId, userId));
      return {
        data: {
          budgets: st.map((b) => {
            const c = cats.find((x) => x.id === b.categoryId);
            return { category: c ? catName(c) : "Overall", period: b.period, spent: fmt(b.spent), available: fmt(b.available), remaining: fmt(b.remaining) };
          }),
        },
        ui: [{ type: "budgets", currency: cur, items: st.map((b) => ({ id: b.id, categoryId: b.categoryId, period: b.period, spent: b.spent, available: b.available, remaining: b.remaining })) }],
      };
    }
    case "get_savings_progress": {
      const goals = await listGoals(db, userId);
      return {
        data: { goals: goals.map((g) => ({ name: g.name, saved: fmt(g.current, g.currency), target: fmt(g.targetAmount, g.currency), progress: Math.round(g.progress * 100) + "%", target_date: g.targetDate })) },
        ui: [{ type: "goals", items: goals.map((g) => ({ id: g.id, name: g.name, currency: g.currency, current: g.current, target: g.targetAmount, progress: g.progress, targetDate: g.targetDate })) }],
      };
    }
    case "prepare_transaction": {
      const currency = typeof input.currency === "string" && (CURRENCY_CODES as string[]).includes(input.currency) ? input.currency : cur;
      const amount = typeof input.amount === "string" ? parseAmount(input.amount, currency) : null;
      const prefill: Record<string, unknown> = {
        type: (USER_TX_TYPES as string[]).includes(String(input.type)) ? input.type : "expense",
        currency, amount: amount && amount > 0 ? amount : null,
        description: typeof input.description === "string" ? input.description.slice(0, 200) : "",
        date: isDateStr(input.date) ? input.date : ctx.today,
      };
      if (typeof input.category_key === "string") {
        const [c] = await db.select().from(schema.categories).where(and(eq(schema.categories.userId, userId), eq(schema.categories.systemKey, input.category_key))).limit(1);
        if (c) prefill.categoryId = c.id;
      }
      if (typeof input.account_name === "string") {
        const accs = await db.select().from(schema.accounts).where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.status, "active")));
        const match = accs.find((a) => a.name.toLowerCase().includes((input.account_name as string).toLowerCase()));
        if (match) prefill[prefill.type === "income" || prefill.type === "refund" ? "toAccountId" : "fromAccountId"] = match.id;
      }
      return { data: { status: "form_opened_for_user_confirmation", saved: false, prefill }, ui: [{ type: "action", action: "add_transaction", prefill }] };
    }
    case "prepare_account": {
      const currency = typeof input.currency === "string" && (CURRENCY_CODES as string[]).includes(input.currency) ? input.currency : cur;
      const type = (ACCOUNT_TYPES as readonly string[]).includes(String(input.type)) ? input.type : "savings";
      const opening = typeof input.opening_balance === "string" ? parseAmount(input.opening_balance, currency) : null;
      const prefill = { name: String(input.name ?? "").slice(0, 80), type, currency, openingBalance: opening ?? 0 };
      return { data: { status: "form_opened_for_user_confirmation", saved: false, prefill }, ui: [{ type: "action", action: "create_account", prefill }] };
    }
    case "prepare_budget": {
      const prefill: Record<string, unknown> = {
        period: (BUDGET_PERIODS as readonly string[]).includes(String(input.period)) ? input.period : "monthly",
        amount: typeof input.amount === "string" ? parseAmount(input.amount, cur) : null,
        currency: cur,
      };
      if (typeof input.category_key === "string") {
        const [c] = await db.select().from(schema.categories).where(and(eq(schema.categories.userId, userId), eq(schema.categories.systemKey, input.category_key))).limit(1);
        if (c) prefill.categoryId = c.id;
      }
      return { data: { status: "form_opened_for_user_confirmation", saved: false, prefill }, ui: [{ type: "action", action: "create_budget", prefill }] };
    }
    case "open_scanner":
      return { data: { status: "scanner_opened" }, ui: [{ type: "action", action: "scan", prefill: { mode: input.mode === "banknote" ? "banknote" : "receipt" } }] };
    case "show_view": {
      const map: Record<string, string> = {
        accounts: "/accounts", transactions: "/transactions", budgets: "/budgets", savings: "/savings", investments: "/investments",
        reports: "/reports?tab=monthly", dashboard_month: "/?period=month", settings: "/settings",
      };
      const href = map[String(input.view)] ?? "/";
      return { data: { status: "link_shown", href }, ui: [{ type: "action", action: "navigate", href }] };
    }
    default:
      return { data: { error: `Unknown tool ${name}` }, ui: [] };
  }
}
