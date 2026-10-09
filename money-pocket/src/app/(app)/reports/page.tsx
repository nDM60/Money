"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import clsx from "clsx";
import { Download, Printer, Lightbulb, Trophy, AlertTriangle, FileJson } from "lucide-react";
import { useApp } from "@/client/app";
import { fetcher } from "@/client/api";
import { Card, Loading, Meter, PageHeader, SectionTitle, Segmented } from "@/components/ui";
import { CashflowChart, DonutList, LinesChart, TrendChart } from "@/components/charts";
import { summaryNarrative } from "@/lib/i18n/summary";
import { todayIn, startOfMonth } from "@/lib/dates";
import type { Key } from "@/lib/i18n";

type Kind = "daily" | "weekly" | "monthly" | "yearly";
type Tab = Kind | "statements";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Summary = any;

export default function ReportsPage() {
  return <Suspense fallback={<Loading />}><Reports /></Suspense>;
}

function Reports() {
  const { t, me } = useApp();
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || "monthly");
  const today = todayIn(me?.settings.timezone ?? "Asia/Vientiane");
  const [anchor, setAnchor] = useState(today);
  return (
    <div>
      <PageHeader title={t("rep.title")} subtitle={t("rep.generated_from")}
        actions={<button className="btn btn-soft no-print" onClick={() => window.print()}><Printer size={16} />{t("common.print")}</button>} />
      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        <Segmented value={tab} onChange={setTab} options={(["daily", "weekly", "monthly", "yearly", "statements"] as Tab[]).map((k) => ({ value: k, label: t(k === "statements" ? "rep.statements" : (`rep.${k}` as Key)) }))} />
        {tab !== "statements" && <input type="date" className="input !w-auto !py-1.5 text-sm" max={today} value={anchor} onChange={(e) => setAnchor(e.target.value || today)} aria-label={t("rep.anchor")} />}
      </div>
      {tab === "statements" ? <Statements /> : <SummaryView kind={tab} anchor={anchor} />}
    </div>
  );
}

function SummaryView({ kind, anchor }: { kind: Kind; anchor: string }) {
  const { t, lang, money, date, catLabel, categories } = useApp();
  const { data: s } = useSWR<Summary>(`/api/summaries/${kind}?date=${anchor}`, fetcher);
  if (!s) return <Loading />;
  const vs = t(`period.vs_prev.${({ daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const)[kind]}` as Key);
  const kpis: [string, string, string?][] = [
    [t("dash.income"), money(s.totals.income), "var(--income)"],
    [t("dash.expenses"), money(s.totals.expense), "var(--expense)"],
    [t("dash.net"), money(s.totals.net, undefined, { sign: true })],
    kind === "daily" ? [t("rep.transactions_today"), String(s.count)] : [t("rep.avg_daily"), money(s.avgDailyExpense)],
  ];
  if (kind !== "daily") kpis.push([t("rep.savings_rate"), s.savingsRate === null ? "—" : `${s.savingsRate}%`]);
  if (kind === "weekly" || kind === "monthly") kpis.push([t("rep.savings_contrib"), money(s.totals.savingsContributions)]);
  if (kind === "daily") kpis.push([t("rep.remaining_daily"), s.remainingDailyBudget === null ? "—" : money(s.remainingDailyBudget)]);
  if (kind === "monthly") kpis.push([t("rep.net_worth_change"), money(s.netWorth.change, undefined, { sign: true })]);

  return (
    <div className="space-y-5">
      <Card className="hero p-6">
        <p className="text-xs uppercase tracking-wide text-white/60">{t(`rep.${kind}` as Key)} · {s.range.start === s.range.end ? date(s.range.start, "long") : `${date(s.range.start)} – ${date(s.range.end)}`}</p>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-white/95">{summaryNarrative(s, lang)}</p>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([l, v, dot]) => (
          <Card key={l} className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-ink-2">{dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}{l}</p>
            <p className="num mt-1 truncate font-bold" title={v}>{v}</p>
          </Card>
        ))}
      </div>
      {s.missingRates?.length > 0 && <p className="flex items-center gap-2 text-sm text-warn"><AlertTriangle size={16} />{t("dash.missing_rates", { pairs: s.missingRates.join(", ") })}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title={kind === "daily" ? t("rep.top_categories") : t("rep.breakdown")} />
          <DonutList items={s.categories.map((c: any) => ({ id: c.id, label: catLabel(c), color: c.color, amount: c.amount }))} total={s.totals.expense} emptyText={t("rep.no_activity")} />
        </Card>
        {kind !== "daily" && (
          <Card className="p-5">
            <SectionTitle title={kind === "yearly" ? t("rep.monthly_trend") : t("dash.income_vs_expenses")} />
            <CashflowChart data={kind === "yearly" ? s.monthly : s.series} />
          </Card>
        )}
        {kind === "daily" && (
          <Card className="p-5">
            <SectionTitle title={t("rep.transactions_today")} />
            {s.transactions.length === 0 ? <p className="text-sm text-muted">{t("rep.no_activity")}</p> : (
              <ul className="divide-y divide-line text-sm">
                {s.transactions.map((x: any) => (
                  <li key={x.id} className="flex justify-between gap-2 py-2"><span className="truncate">{x.description || x.merchant || t(`tx.type.${x.type}` as Key)}</span><span className="num font-medium">{x.value === null ? "—" : money(x.value)}</span></li>
                ))}
              </ul>
            )}
            {s.unusual.length > 0 && (
              <div className="mt-4 rounded-xl border border-warn/40 p-3">
                <p className="mb-1 text-xs font-semibold text-warn">⚠ {t("rep.unusual")}</p>
                {s.unusual.map((u: any) => <p key={u.id} className="text-sm">{u.description || u.merchant}: <b className="num">{money(u.value)}</b></p>)}
              </div>
            )}
          </Card>
        )}
        {(kind === "daily" || kind === "monthly") && s.accountChanges.length > 0 && (
          <Card className="p-5">
            <SectionTitle title={t("rep.account_changes")} />
            <ul className="divide-y divide-line text-sm">
              {s.accountChanges.map((a: any) => (
                <li key={a.id} className="flex justify-between py-2"><span>{a.name}</span><span className={clsx("num font-medium", a.change < 0 ? "text-neg" : a.change > 0 ? "text-pos" : "")}>{money(a.change, a.currency, { sign: true })}{kind === "monthly" && <span className="ml-2 text-xs font-normal text-muted">→ {money(a.end, a.currency)}</span>}</span></li>
              ))}
            </ul>
          </Card>
        )}
        {kind !== "daily" && kind !== "yearly" && (
          <Card className="p-5">
            <SectionTitle title={t("rep.comparison")} />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted">{t("dash.expenses")}</p><p className="num font-semibold">{money(s.totals.expense)}</p><p className="num text-xs text-muted">{money(s.prevTotals.expense)} · {s.change.expense === null ? "—" : `${s.change.expense > 0 ? "▲" : "▼"} ${Math.abs(s.change.expense)}%`} {vs}</p></div>
              <div><p className="text-xs text-muted">{t("dash.income")}</p><p className="num font-semibold">{money(s.totals.income)}</p><p className="num text-xs text-muted">{money(s.prevTotals.income)} · {s.change.income === null ? "—" : `${s.change.income > 0 ? "▲" : "▼"} ${Math.abs(s.change.income)}%`} {vs}</p></div>
            </div>
          </Card>
        )}
        {s.budgets.length > 0 && kind !== "yearly" && (
          <Card className="p-5">
            <SectionTitle title={t("rep.budget_performance")} />
            <ul className="space-y-3">
              {s.budgets.map((b: any) => {
                const c = categories.find((x) => x.id === b.categoryId);
                const r = b.available > 0 ? b.spent / b.available : 1;
                return (
                  <li key={b.id}>
                    <div className="mb-1 flex justify-between text-sm"><span>{c ? catLabel(c) : t("budgets.overall")}</span><span className={clsx("text-xs", b.remaining < 0 ? "text-neg" : "text-muted")}>{b.remaining < 0 ? t("rep.exceeded") : t("rep.within")}</span></div>
                    <Meter value={r} color={r >= 1 ? "var(--bad)" : r >= 0.8 ? "var(--warn)" : "var(--good)"} />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        {kind === "yearly" && (
          <>
            <Card className="p-5"><SectionTitle title={t("rep.net_worth_history")} /><LinesChart data={s.netWorthHistory} lines={[{ key: "total", name: t("dash.net_worth"), color: "var(--brand)" }, { key: "savings", name: t("dash.savings"), color: "var(--savings)" }]} /></Card>
            <Card className="p-5">
              <SectionTitle title={t("rep.milestones")} />
              <ul className="space-y-2 text-sm">
                {s.milestones.map((m: any, i: number) => {
                  const v = { ...m.vars };
                  if (typeof v.net === "number") v.net = money(v.net);
                  if (typeof v.value === "number") v.value = money(v.value);
                  if (typeof v.month === "string") v.month = date(v.month, "month");
                  return <li key={i} className="flex gap-2"><Trophy size={16} className="shrink-0 text-warn" />{t(`rep.milestone.${m.key}` as Key, v)}</li>;
                })}
              </ul>
              {s.budgetMonths.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-xs font-semibold text-muted">{t("rep.budget_performance")}</p>
                  <div className="flex flex-wrap gap-1.5">{s.budgetMonths.map((b: any) => <span key={b.month} className={clsx("chip", b.within ? "!text-good" : "!text-bad")}>{date(b.month, "month").split(" ")[0]} {b.within ? "✓" : "✗"}</span>)}</div>
                </div>
              )}
            </Card>
          </>
        )}
        {kind === "monthly" && s.recurringBills.length > 0 && (
          <Card className="p-5">
            <SectionTitle title={t("rep.recurring_bills")} action={<Link className="btn btn-ghost btn-sm" href="/recurring">{t("common.view_all")}</Link>} />
            <ul className="divide-y divide-line text-sm">{s.recurringBills.map((b: any) => <li key={b.id} className="flex justify-between py-2"><span>{b.name} <span className="text-xs text-muted">· {date(b.nextDueDate, "short")}</span></span><span className="num">{money(b.amount, b.currency)}</span></li>)}</ul>
          </Card>
        )}
        {kind === "weekly" && <Card className="p-5"><SectionTitle title={t("dash.spending_trend")} /><TrendChart data={s.series} name={t("dash.expenses")} /></Card>}
      </div>
      {s.suggestions.length > 0 && kind !== "daily" && (
        <Card className="p-5">
          <SectionTitle title={t("rep.suggestions")} />
          <ul className="space-y-2 text-sm">{s.suggestions.map((x: any, i: number) => <li key={i} className="flex gap-2"><Lightbulb size={16} className="shrink-0 text-brand" />{t(`rep.suggest.${x.key}` as Key, x.vars)}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

function Statements() {
  const { t, me, activeAccounts } = useApp();
  const today = todayIn(me?.settings.timezone ?? "Asia/Vientiane");
  const [start, setStart] = useState(startOfMonth(today));
  const [end, setEnd] = useState(today);
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? "");
  const range = new URLSearchParams({ start, end }).toString();
  const links: { label: string; href: string; icon?: typeof Download }[] = [
    { label: t("rep.export_transactions"), href: `/api/export/transactions.csv?${range}` },
    { label: t("rep.statement_category"), href: `/api/export/categories-report.csv?${range}` },
    { label: t("rep.export_accounts"), href: "/api/export/accounts.csv" },
    { label: t("rep.statement_networth"), href: "/api/export/monthly.csv" },
    { label: t("acc.snapshots"), href: "/api/export/snapshots.csv" },
    { label: t("rep.export_json"), href: "/api/export/json", icon: FileJson },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <SectionTitle title={t("common.export_csv")} hint={t("set.sheets_hint")} />
        <div className="mb-4 flex flex-wrap gap-2">
          <input type="date" className="input !w-auto" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t("common.start")} />
          <input type="date" className="input !w-auto" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t("common.end")} />
        </div>
        <ul className="space-y-2">
          {links.map((l) => {
            const I = l.icon ?? Download;
            return <li key={l.href}><a className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm font-medium hover:border-brand" href={l.href}><I size={16} className="text-brand" />{l.label}</a></li>;
          })}
        </ul>
      </Card>
      <Card className="p-5">
        <SectionTitle title={t("rep.statement_account")} />
        <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t("rep.choose_account")}>
          {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {accountId && <Link className="btn btn-primary mt-3" href={`/accounts/${accountId}`}>{t("acc.statement")}</Link>}
        <div className="mt-6 border-t border-line pt-4">
          <SectionTitle title={t("rep.statement_month")} />
          <Link className="btn btn-soft" href="/reports?tab=monthly" onClick={() => location.assign("/reports?tab=monthly")}>{t("rep.monthly")}</Link>
        </div>
      </Card>
    </div>
  );
}
