/** Structured UI blocks the assistant can return; rendered by the chat screen. */

export interface CategoryAmount { id: string; name: string | null; systemKey: string | null; color: string; amount: number; share: number }

export type UiBlock =
  | { type: "summary"; label: string; range: { start: string; end: string }; currency: string; income: number; expense: number; net: number; count: number; topCategories: CategoryAmount[] }
  | { type: "categories"; label: string; currency: string; items: CategoryAmount[] }
  | { type: "cashflow"; label: string; currency: string; series: { key: string; income: number; expense: number }[] }
  | { type: "comparison"; label: string; currency: string; current: { label: string; income: number; expense: number }; previous: { label: string; income: number; expense: number }; change: { income: number | null; expense: number | null } }
  | { type: "transactions"; label: string; items: { id: string; date: string; type: string; amount: number; currency: string; description: string; merchant: string | null }[]; total?: number }
  | { type: "accounts"; currency: string; netWorth: number; availableCash: number; accounts: { id: string; name: string; type: string; currency: string; balance: number }[] }
  | { type: "budgets"; currency: string; items: { id: string; categoryId: string | null; period: string; spent: number; available: number; remaining: number }[] }
  | { type: "goals"; items: { id: string; name: string; currency: string; current: number; target: number; progress: number; targetDate: string | null }[] }
  | { type: "action"; action: "add_transaction" | "create_account" | "create_budget" | "create_goal" | "scan" | "navigate"; prefill?: Record<string, unknown>; href?: string; note?: string };

export interface ChatReply {
  sessionId: string;
  message: string;
  ui: UiBlock[];
  engine: "claude" | "rules";
}
