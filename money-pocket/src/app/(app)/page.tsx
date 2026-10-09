"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, AlertTriangle, Wallet, ChevronRight } from "lucide-react";
import { useApp } from "@/client/app";
import { fetcher } from "@/client/api";
import type { Transaction } from "@/client/types";
import { Card, Empty, Loading, Meter, SectionTitle, Segmented } from "@/components/ui";
import { CashflowChart, DistributionBars, DonutList, LinesChart, TrendChart } from "@/components/charts";
import { TxRow } from "@/components/tx-list";
import type { Period } from "@/lib/dates";
import type { Key } from "@/lib/i18n";

interface Dash {
  range: { start: string; end: string }; bucket: string; period: Period; today: string; currency: string;
  totals: { income: number; expense: number; net: number; count: number; savingsContributions: number };
  prevTotals: { income: number; expense: number; net: number };
  change: { income: number | null; expense: number | null };
  overview: Record<"netWorth" | "availableCash" | "cash" | "bank" | "savings" | "investments" | "liabilities" | "unrealized" | "todayIncome" | "todayExpense" | "monthIncome" | "monthExpense", number> & { remainingBudget: number | null };
  accounts: { id: string; name: string; type: string; color: string; currency: string; status: string; balance: number; converted: number | null }[];
  series: { key: string; income: number; expense: number; net: number }[];
  daily: { key: string; income: number; expense: number }[];
  balances: { key: string; total: number; savings: number; investment: number; cash: number }[];
  categories: { id: string; name: string | null; systemKey: string | null; color: string; amount: number; share: number }[];
  budgets: { id: string; categoryId: string | null; period: string; spent: number; available: number; remaining: number }[];
  missingRates: string[];
}

export default function DashboardPage() {
  return <Suspense fallback={<Loading />}><Dashboard /></Suspense>;
}

function Dashboard() {
  const { t, me, money, date, activeAccounts, categories, catLabel, open } = useApp();
  const sp = useSearchParams();
  const [period, setPeriod] = useState<Period>((sp.get("period") as Period) || "month");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const q = new URLSearchParams({ period });
  if (period === "custom" && start) q.set("start", start);
  if (period === "custom" && end) q.set("end", end);
  if (accountId) q.set("accountId", accountId);
  if (categoryId) q.set("categoryId", categoryId);
  const { data: d, isLoading } = useSWR<Dash>(`/api/dashboard?${q}`, fetcher, { keepPreviousData: true });
  const { data: recent } = useSWR<{ items: Transaction[] }>("/api/transactions?pageSize=6", fetcher);

  if (me && me.accounts.length === 0) {
    return (
      <Card className="mt-6">
        <Empty icon={<Wallet size={40} />} title={t("dash.empty_title")} body={t("dash.empty_body")}
          action={<Link href="/setup" className="btn btn-primary">{t("dash.empty_cta")}</Link>} />
      </Card>
    );
  }
  if (!d) return <Loading />;

  const o = d.overview;
  const vs = t(`period.vs_prev.${d.period}` as Key);
  const rangeLabel = d.range.start === d.range.end ? date(d.range.start, "long") : `${date(d.range.start)} – ${date(d.range.end)}`;
  const tiles: { label: string; value: number; dot: string; sub?: string }[] = [
    { label: t("dash.today_income"), value: o.todayIncome, dot: "var(--income)" },
    { label: t("dash.today_expense"), value: o.todayExpense, dot: "var(--expense)" },
    { label: t("dash.month_income"), value: o.monthIncome, dot: "var(--income)" },
    { label: t("dash.month_expense"), value: o.monthExpense, dot: "var(--expense)" },
    { label: t("dash.bank"), value: o.bank, dot: "var(--brand)" },
    { label: t("dash.savings"), value: o.savings, dot: "var(--savings)" },
    { label: t("dash.investments"), value: o.investments, dot: "var(--invest)", sub: o.unrealized ? t("dash.unrealized", { amount: money(o.unrealized, undefined, { sign: true }) }) : undefined },
  ];
  const visibleAccounts = d.accounts.filter((a) => a.status === "active" && a.converted !== null).sort((a, b) => (b.converted ?? 0) - (a.converted ?? 0));

  return (
    <div className={clsx("space-y-5 transition-opacity", isLoading && "opacity-70")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("dash.greeting", { name: me?.user.name || "" }).replace(/,\s*$/, "")}</h1>
          <p className="text-sm text-muted">{date(d.today, "long")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Period" value={period} onChange={setPeriod} options={(["day", "week", "month", "year", "custom"] as Period[]).map((p) => ({ value: p, label: t(`period.${p}` as Key) }))} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {period === "custom" && (
          <>
            <input type="date" className="input !w-auto !py-1.5 text-sm" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t("common.start")} />
            <span className="text-muted">–</span>
            <input type="date" className="input !w-auto !py-1.5 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t("common.end")} />
          </>
        )}
        <select className="input !w-auto !py-1.5 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t("tx.account")}>
          <option value="">{t("dash.all_accounts")}</option>
          {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="input !w-auto !py-1.5 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={t("tx.category")}>
          <option value="">{t("dash.all_categories")}</option>
          {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}
        </select>
        <span className="text-xs text-muted">{rangeLabel}</span>
      </div>

      {d.missingRates.length > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-warn/40 bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-3 text-sm text-ink-2">
          <AlertTriangle size={18} className="shrink-0 text-warn" />
          <span>{t("dash.missing_rates", { pairs: d.missingRates.join(", ").replace(/>/g, "→") })} <Link className="font-semibold text-brand" href="/settings">{t("nav.settings")}</Link></span>
        </div>
      )}

      {/* Hero */}
      <section className="hero overflow-hidden rounded-3xl p-6 shadow-xl sm:p-8">
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-sm text-white/70">{t("dash.net_worth")}</p>
            <p className="num mt-1 text-4xl font-bold tracking-tight sm:text-5xl">{money(o.netWorth)}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <HeroChip label={t("dash.available_cash")} value={money(o.availableCash)} />
              {o.liabilities !== 0 && <HeroChip label={t("dash.liabilities")} value={money(o.liabilities)} />}
              <HeroChip label={t("dash.remaining_budget")} value={o.remainingBudget === null ? t("dash.no_budget") : money(o.remainingBudget)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 self-end">
            <HeroStat icon={<ArrowDownRight size={16} />} label={`${t("dash.income")} · ${t(`period.${d.period}` as Key)}`} value={money(d.totals.income)} change={d.change.income} good="up" vs={vs} />
            <HeroStat icon={<ArrowUpRight size={16} />} label={`${t("dash.expenses")} · ${t(`period.${d.period}` as Key)}`} value={money(d.totals.expense)} change={d.change.expense} good="down" vs={vs} />
            <div className="col-span-2 rounded-2xl bg-white/10 px-4 py-3">
              <p className="text-xs text-white/70">{t("dash.net")}</p>
              <p className="num text-lg font-semibold">{money(d.totals.net, undefined, { sign: true })}</p>
            </div>
          </div>
        </div>
      </section>

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map((x) => (
          <Card key={x.label} className="p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-2"><span className="h-2 w-2 rounded-full" style={{ background: x.dot }} />{x.label}</p>
            <p className="num mt-1.5 truncate text-[17px] font-bold" title={money(x.value)}>{money(x.value, undefined, { compact: true })}</p>
            {x.sub && <p className="mt-0.5 truncate text-[11px] text-muted">{x.sub}</p>}
          </Card>
        ))}
      </section>

      {/* Charts */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title={t("dash.income_vs_expenses")} hint={t("dash.cashflow_note")} />
          {d.series.some((s) => s.income || s.expense) ? <CashflowChart data={d.series} /> : <p className="py-16 text-center text-sm text-muted">{t("dash.no_data")}</p>}
        </Card>
        <Card className="p-5">
          <SectionTitle title={t("dash.by_category")} />
          <DonutList items={d.categories.map((c) => ({ id: c.id, label: catLabel(c), color: c.color, amount: c.amount }))} total={d.totals.expense} emptyText={t("dash.no_data")}
            onSelect={(id) => id !== "uncategorized" && setCategoryId(id)} />
        </Card>
        <Card className="p-5">
          <SectionTitle title={t("dash.spending_trend")} />
          <TrendChart data={d.daily} name={t("dash.expenses")} />
        </Card>
        <Card className="p-5">
          <SectionTitle title={t("dash.net_worth_growth")} hint={t("dash.networth_note")} />
          <LinesChart data={d.balances} lines={[{ key: "total", name: t("dash.net_worth"), color: "var(--brand)" }]} />
        </Card>
        <Card className="p-5">
          <SectionTitle title={t("dash.savings_growth")} />
          <LinesChart data={d.balances} lines={[{ key: "savings", name: t("dash.savings"), color: "var(--savings)" }, { key: "investment", name: t("dash.investments"), color: "var(--invest)" }]} />
        </Card>
        <Card className="p-5">
          <SectionTitle title={t("dash.account_distribution")} action={<Link href="/accounts" className="btn btn-ghost btn-sm">{t("common.view_all")}<ChevronRight size={14} /></Link>} />
          <DistributionBars items={visibleAccounts.map((a) => ({ id: a.id, label: a.name, color: a.color, value: a.converted ?? 0 }))} />
        </Card>
        <Card className="p-5">
          <SectionTitle title={t("dash.budget_utilization")} action={<Link href="/budgets" className="btn btn-ghost btn-sm">{t("common.view_all")}<ChevronRight size={14} /></Link>} />
          {d.budgets.length === 0 ? (
            <Empty title={t("budgets.empty")} action={<button className="btn btn-soft btn-sm" onClick={() => open("budget", {})}>{t("budgets.add")}</button>} />
          ) : (
            <ul className="space-y-4">
              {d.budgets.slice(0, 6).map((b) => {
                const c = categories.find((x) => x.id === b.categoryId);
                const r = b.available > 0 ? b.spent / b.available : b.spent > 0 ? 1 : 0;
                return (
                  <li key={b.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{c ? catLabel(c) : t("budgets.overall")} <span className="text-xs font-normal text-muted">· {t(`period.${b.period}` as Key)}</span></span>
                      <span className={clsx("num text-xs", b.remaining < 0 ? "font-semibold text-neg" : "text-muted")}>{b.remaining < 0 ? t("budgets.over", { amount: money(-b.remaining) }) : t("budgets.left", { amount: money(b.remaining) })}</span>
                    </div>
                    <Meter value={r} color={r >= 1 ? "var(--bad)" : r >= 0.8 ? "var(--warn)" : "var(--good)"} label={`${Math.round(r * 100)}%`} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <SectionTitle title={t("dash.recent")} action={<Link href="/transactions" className="btn btn-ghost btn-sm">{t("common.view_all")}<ChevronRight size={14} /></Link>} />
          {recent?.items.length ? <div className="-mx-2">{recent.items.map((x) => <TxRow key={x.id} tx={x} />)}</div> : <Empty title={t("tx.empty")} action={<button className="btn btn-primary btn-sm" onClick={() => open("tx", {})}>{t("tx.add")}</button>} />}
        </Card>
      </div>
    </div>
  );
}

function HeroChip({ label, value }: { label: string; value: string }) {
  return <span className="rounded-full bg-white/10 px-3 py-1.5 text-white/90"><span className="text-white/60">{label}: </span><b className="num font-semibold">{value}</b></span>;
}

function HeroStat({ icon, label, value, change, good, vs }: { icon: React.ReactNode; label: string; value: string; change: number | null; good: "up" | "down"; vs: string }) {
  const positive = change !== null && (good === "up" ? change >= 0 : change <= 0);
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-3">
      <p className="flex items-center gap-1 truncate text-xs text-white/70">{icon}{label}</p>
      <p className="num truncate text-lg font-semibold">{value}</p>
      <p className="truncate text-[11px] text-white/60">
        {change === null ? "—" : <><span className={positive ? "text-[#86efac]" : "text-[#fdba74]"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}%</span> {vs}</>}
      </p>
    </div>
  );
}
