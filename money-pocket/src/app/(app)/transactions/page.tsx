"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Plus, Search, SlidersHorizontal, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useApp } from "@/client/app";
import { fetcher } from "@/client/api";
import type { Transaction } from "@/client/types";
import { Card, Empty, Field, Loading, PageHeader } from "@/components/ui";
import { TxRow } from "@/components/tx-list";
import { USER_TX_TYPES } from "@/lib/domain";
import { parseAmount } from "@/lib/money";
import type { Key } from "@/lib/i18n";

export default function TransactionsPage() {
  return <Suspense fallback={<Loading />}><Transactions /></Suspense>;
}

function Transactions() {
  const { t, open, activeAccounts, categories, catLabel, currency, date } = useApp();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showFilters, setShowFilters] = useState(!!sp.get("uncategorized"));
  const [accountId, setAccountId] = useState(sp.get("accountId") ?? "");
  const [categoryId, setCategoryId] = useState(sp.get("categoryId") ?? "");
  const [type, setType] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [uncategorized, setUncategorized] = useState(sp.get("uncategorized") === "1");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(1), [debounced, accountId, categoryId, type, start, end, min, max, uncategorized, sort]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "30", sort });
    if (debounced) p.set("q", debounced);
    if (accountId) p.set("accountId", accountId);
    if (categoryId) p.set("categoryId", categoryId);
    if (type) p.set("type", type);
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    const mn = min ? parseAmount(min, currency) : null;
    const mx = max ? parseAmount(max, currency) : null;
    if (mn !== null) p.set("min", String(mn));
    if (mx !== null) p.set("max", String(mx));
    if (uncategorized) p.set("uncategorized", "1");
    return p.toString();
  }, [page, sort, debounced, accountId, categoryId, type, start, end, min, max, uncategorized, currency]);

  const { data, mutate, isLoading } = useSWR<{ items: Transaction[]; total: number; page: number; pageSize: number }>(`/api/transactions?${params}`, fetcher, { keepPreviousData: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const x of data?.items ?? []) m.set(x.localDate, [...(m.get(x.localDate) ?? []), x]);
    return [...m.entries()];
  }, [data]);
  const activeFilters = [accountId, categoryId, type, start, end, min, max, uncategorized ? "1" : ""].filter(Boolean).length;
  const clear = () => { setAccountId(""); setCategoryId(""); setType(""); setStart(""); setEnd(""); setMin(""); setMax(""); setUncategorized(false); };
  const exportHref = `/api/export/transactions.csv${start || end ? `?${new URLSearchParams({ ...(start ? { start } : {}), ...(end ? { end } : {}) })}` : ""}`;

  return (
    <div>
      <PageHeader title={t("nav.transactions")} subtitle={data ? t("tx.count", { count: data.total }) : undefined}
        actions={<>
          <a className="btn btn-soft" href={exportHref}><Download size={16} />{t("common.export_csv")}</a>
          <button className="btn btn-primary" onClick={() => open("tx", {})}><Plus size={16} />{t("tx.add")}</button>
        </>} />
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" placeholder={t("tx.search_placeholder")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("common.search")} />
          </div>
          <button className="btn btn-soft" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <SlidersHorizontal size={16} />{t("common.filters")}{activeFilters > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] text-brand-ink">{activeFilters}</span>}
          </button>
          <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {["date_desc", "date_asc", "amount_desc", "amount_asc"].map((s) => <option key={s} value={s}>{t(`tx.sort.${s}` as Key)}</option>)}
          </select>
        </div>
        {showFilters && (
          <div className="mt-3 grid gap-3 border-t border-line pt-3 fade-in sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("tx.account")}>
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">{t("common.all")}</option>
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label={t("tx.category")}>
              <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t("common.all")}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}
              </select>
            </Field>
            <Field label={t("common.type")}>
              <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{t("common.all")}</option>
                {USER_TX_TYPES.map((x) => <option key={x} value={x}>{t(`tx.type.${x}` as Key)}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("tx.min")}><input className="input num" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
              <Field label={t("tx.max")}><input className="input num" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
            </div>
            <Field label={t("common.from")}><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label={t("common.to")}><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={uncategorized} onChange={(e) => setUncategorized(e.target.checked)} />{t("tx.uncategorized_only")}</label>
            <div className="self-end"><button className="btn btn-ghost" onClick={clear}>{t("common.clear")}</button></div>
          </div>
        )}
      </Card>

      <Card className="mt-4 p-3">
        {!data && isLoading ? <Loading /> : !data?.items.length ? <Empty title={t("tx.empty")} /> : groups.map(([d, items]) => (
          <div key={d} className="mb-2">
            <div className="sticky top-14 z-[1] bg-card px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted lg:top-0">{date(d, "long")}</div>
            {items.map((x) => <TxRow key={x.id} tx={x} showDate={false} onChange={() => mutate()} />)}
          </div>
        ))}
        {data && pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-2 pt-3 text-sm">
            <button className="btn btn-soft btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} />{t("common.previous")}</button>
            <span className="text-muted">{t("common.page", { page, pages })}</span>
            <button className="btn btn-soft btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("common.next")}<ChevronRight size={16} /></button>
          </div>
        )}
      </Card>
    </div>
  );
}
