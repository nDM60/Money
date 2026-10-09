/**
 * Core financial domain rules shared by client and server.
 *
 * Every transaction moves money from `from` (an owned account, or outside the
 * user's books when null) to `to` (an owned account, or outside when null).
 * Only `income`/`refund` (outside -> owned) and `expense` (owned -> outside)
 * are reported as income/expenses. Movements between owned accounts never are.
 */

export const TX_TYPES = [
  "income",
  "expense",
  "transfer",
  "savings_contribution",
  "investment_purchase",
  "investment_sale",
  "refund",
  "adjustment",
  "debt_repayment",
  "loan_received",
  "loan_repayment",
  "valuation",
] as const;
export type TxType = (typeof TX_TYPES)[number];

/** Types the user can pick in the transaction form ("valuation" is system-generated). */
export const USER_TX_TYPES: TxType[] = TX_TYPES.filter((t) => t !== "valuation");

type Shape = { from: "required" | "none" | "either"; to: "required" | "none" | "either"; report: "income" | "expense" | "internal" | "adjustment" | "valuation" };

export const TX_SHAPE: Record<TxType, Shape> = {
  income: { from: "none", to: "required", report: "income" },
  refund: { from: "none", to: "required", report: "income" },
  expense: { from: "required", to: "none", report: "expense" },
  transfer: { from: "required", to: "required", report: "internal" },
  savings_contribution: { from: "required", to: "required", report: "internal" },
  investment_purchase: { from: "required", to: "required", report: "internal" },
  investment_sale: { from: "required", to: "required", report: "internal" },
  debt_repayment: { from: "required", to: "required", report: "internal" },
  loan_received: { from: "required", to: "required", report: "internal" },
  loan_repayment: { from: "required", to: "required", report: "internal" },
  // Exactly one side: money appears in (to) or disappears from (from) an account.
  adjustment: { from: "either", to: "either", report: "adjustment" },
  valuation: { from: "either", to: "either", report: "valuation" },
};

export function isInternal(t: TxType) {
  return TX_SHAPE[t].report === "internal";
}

export const ACCOUNT_TYPES = ["cash", "bank", "savings", "investment", "ewallet", "credit", "loan", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Account types whose balance is a liability (normally <= 0). */
export const LIABILITY_TYPES: AccountType[] = ["credit", "loan"];
/** Account types counted as "available cash". */
export const CASH_TYPES: AccountType[] = ["cash", "bank", "ewallet"];

export const ACCOUNT_ICONS = ["wallet", "landmark", "piggy-bank", "trending-up", "smartphone", "credit-card", "hand-coins", "shield", "utensils", "plane", "beer", "shopping-basket", "circle"] as const;
export const COLORS = ["#0f766e", "#1d4ed8", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#475569", "#be123c"] as const;

export const BUDGET_PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const RECURRING_FREQ = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;
export type RecurringFreq = (typeof RECURRING_FREQ)[number];

export const PAYMENT_METHODS = ["cash", "bank_transfer", "card", "qr", "ewallet", "other"] as const;

export const ASSET_TYPES = ["stock", "fund", "bond", "crypto", "gold", "deposit", "real_estate", "other"] as const;

export interface DefaultCategory {
  key: string;
  kind: "expense" | "income";
  icon: string;
  color: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: "food", kind: "expense", icon: "utensils", color: "#ea580c" },
  { key: "groceries", kind: "expense", icon: "shopping-basket", color: "#16a34a" },
  { key: "transport", kind: "expense", icon: "bus", color: "#0891b2" },
  { key: "fuel", kind: "expense", icon: "fuel", color: "#475569" },
  { key: "housing", kind: "expense", icon: "home", color: "#7c3aed" },
  { key: "utilities", kind: "expense", icon: "zap", color: "#ca8a04" },
  { key: "shopping", kind: "expense", icon: "shopping-bag", color: "#db2777" },
  { key: "entertainment", kind: "expense", icon: "beer", color: "#be123c" },
  { key: "fitness", kind: "expense", icon: "dumbbell", color: "#0f766e" },
  { key: "healthcare", kind: "expense", icon: "heart-pulse", color: "#dc2626" },
  { key: "education", kind: "expense", icon: "graduation-cap", color: "#1d4ed8" },
  { key: "travel", kind: "expense", icon: "plane", color: "#0284c7" },
  { key: "subscriptions", kind: "expense", icon: "repeat", color: "#6d28d9" },
  { key: "family", kind: "expense", icon: "users", color: "#c2410c" },
  { key: "gifts", kind: "expense", icon: "gift", color: "#e11d48" },
  { key: "personal_care", kind: "expense", icon: "sparkles", color: "#a21caf" },
  { key: "bills", kind: "expense", icon: "receipt", color: "#57534e" },
  { key: "bank_fees", kind: "expense", icon: "landmark", color: "#64748b" },
  { key: "other_expense", kind: "expense", icon: "circle", color: "#94a3b8" },
  { key: "salary", kind: "income", icon: "briefcase", color: "#059669" },
  { key: "bonus", kind: "income", icon: "award", color: "#10b981" },
  { key: "freelance", kind: "income", icon: "laptop", color: "#14b8a6" },
  { key: "business", kind: "income", icon: "store", color: "#0d9488" },
  { key: "interest", kind: "income", icon: "percent", color: "#2563eb" },
  { key: "dividends", kind: "income", icon: "coins", color: "#7c3aed" },
  { key: "investment_gains", kind: "income", icon: "trending-up", color: "#9333ea" },
  { key: "refunds", kind: "income", icon: "undo-2", color: "#0891b2" },
  { key: "other_income", kind: "income", icon: "circle", color: "#64748b" },
];

export const LANGUAGES = ["en", "lo", "th", "vi"] as const;
export type Lang = (typeof LANGUAGES)[number];
export function isLang(l: unknown): l is Lang {
  return typeof l === "string" && (LANGUAGES as readonly string[]).includes(l);
}
