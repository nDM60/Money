import { translate, type Key } from "./index";
import { categoryLabel } from "./categories";
import { formatMoney } from "../money";

interface SummaryFacts {
  kind: "daily" | "weekly" | "monthly" | "yearly";
  currency: string;
  totals: { income: number; expense: number; net: number; count: number };
  change: { income: number | null; expense: number | null };
  topCategories: { name: string | null; systemKey: string | null; share: number }[];
  savingsRate: number | null;
  avgDailyExpense: number;
}

const VS: Record<SummaryFacts["kind"], Key> = { daily: "period.vs_prev.day", weekly: "period.vs_prev.week", monthly: "period.vs_prev.month", yearly: "period.vs_prev.year" };

/** Concise natural-language explanation generated only from computed facts. */
export function summaryNarrative(s: SummaryFacts, lang: string): string {
  const t = (k: Key, v?: Record<string, string | number>) => translate(lang, k, v);
  const m = (v: number, sign = false) => formatMoney(v, s.currency, lang, { sign });
  if (s.totals.count === 0) return t("rep.narrative.empty");
  const parts: string[] = [];
  parts.push(s.totals.income > 0
    ? t("rep.narrative.income_expense", { income: m(s.totals.income), expense: m(s.totals.expense), net: m(s.totals.net, true) })
    : t("rep.narrative.no_income", { expense: m(s.totals.expense) }));
  if (s.kind !== "daily" && s.totals.expense > 0) parts.push(t("rep.narrative.avg", { avg: m(s.avgDailyExpense) }));
  if (s.savingsRate !== null && s.kind !== "daily") parts.push(t("rep.narrative.savings_rate", { rate: s.savingsRate }));
  const top = s.topCategories[0];
  if (top && s.totals.expense > 0) {
    const name = top.name ? categoryLabel({ name: top.name, systemKey: top.systemKey }, lang) : t("common.uncategorized");
    parts.push(t("rep.narrative.top", { name, share: Math.round(top.share * 100) }));
  }
  if (s.change.expense !== null && s.change.expense !== 0) {
    parts.push(t(s.change.expense > 0 ? "rep.narrative.change_up" : "rep.narrative.change_down", { pct: Math.abs(s.change.expense), vs: t(VS[s.kind]) }));
  }
  return parts.join(" ");
}
