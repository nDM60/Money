"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus, Info, Pencil, Trash2 } from "lucide-react";
import { useApp, errorText } from "@/client/app";
import { api, fetcher } from "@/client/api";
import { Card, Empty, Field, Loading, Modal, PageHeader } from "@/components/ui";
import { ASSET_TYPES } from "@/lib/domain";
import { parseAmount, toDecimalString } from "@/lib/money";
import { todayIn } from "@/lib/dates";
import type { Key } from "@/lib/i18n";

interface Holding {
  id: string; accountId: string; name: string; symbol: string | null; assetType: string; units: string; costBasis: number; marketValue: number | null;
  valuedAt: string | null; currency: string; unrealized: number | null; income: number; realized: number; notes: string | null;
}

export default function InvestmentsPage() {
  const { t, money, date, accountName, activeAccounts, open, confirm, toast } = useApp();
  const { data, mutate } = useSWR<Holding[]>("/api/holdings", fetcher);
  const [form, setForm] = useState<Partial<Holding> | null>(null);
  const [valuing, setValuing] = useState<Holding | null>(null);
  const invAccounts = activeAccounts.filter((a) => a.type === "investment");
  if (!data) return <Loading />;
  const byCur = data.reduce<Record<string, { cost: number; value: number; unrealized: number; realized: number; income: number }>>((acc, h) => {
    const x = (acc[h.currency] ??= { cost: 0, value: 0, unrealized: 0, realized: 0, income: 0 });
    x.cost += h.costBasis; x.value += h.marketValue ?? h.costBasis; x.unrealized += h.unrealized ?? 0; x.realized += h.realized; x.income += h.income;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <PageHeader title={t("inv.title")} actions={invAccounts.length ? <button className="btn btn-primary" onClick={() => setForm({ accountId: invAccounts[0].id, assetType: "fund" })}><Plus size={16} />{t("inv.add")}</button> : undefined} />
      <div className="flex gap-2 rounded-2xl bg-card-2 p-3 text-xs text-ink-2"><Info size={16} className="shrink-0 text-brand" /><span>{t("inv.manual_note")} {t("inv.transfer_note")}</span></div>
      {!invAccounts.length && <Card><Empty title={t("inv.need_account")} action={<button className="btn btn-primary" onClick={() => open("account", { prefill: { type: "investment" } })}>{t("acc.add")}</button>} /></Card>}
      {Object.entries(byCur).map(([c, x]) => (
        <div key={c} className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            [t("inv.cost"), x.cost], [t("inv.value"), x.value], [t("inv.unrealized"), x.unrealized], [t("inv.realized"), x.realized], [t("inv.income"), x.income],
          ].map(([l, v], i) => (
            <Card key={i} className="p-4">
              <p className="text-xs text-muted">{l}</p>
              <p className={`num mt-1 font-bold ${i >= 2 && (v as number) < 0 ? "text-neg" : i >= 2 && (v as number) > 0 ? "text-pos" : ""}`}>{money(v as number, c, { sign: i >= 2 })}</p>
            </Card>
          ))}
        </div>
      ))}
      {invAccounts.length > 0 && (
        <Card className="overflow-x-auto p-0">
          {data.length === 0 ? <Empty title={t("inv.empty")} /> : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="p-3">{t("common.name")}</th><th className="p-3">{t("inv.units")}</th><th className="p-3 text-right">{t("inv.cost")}</th>
                  <th className="p-3 text-right">{t("inv.value")}</th><th className="p-3 text-right">{t("inv.unrealized")}</th><th className="p-3 text-right">{t("inv.income")}</th><th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {data.map((h) => (
                  <tr key={h.id} className="border-b border-line last:border-0">
                    <td className="p-3">
                      <p className="font-semibold">{h.name} {h.symbol && <span className="text-xs text-muted">{h.symbol}</span>}</p>
                      <p className="text-xs text-muted">{t(`inv.asset.${h.assetType}` as Key)} · {accountName(h.accountId)}</p>
                    </td>
                    <td className="num p-3">{h.units}</td>
                    <td className="num p-3 text-right">{money(h.costBasis, h.currency)}</td>
                    <td className="p-3 text-right">
                      {h.marketValue === null ? <span className="text-xs text-muted">{t("inv.not_valued")}</span> : <>
                        <p className="num">{money(h.marketValue, h.currency)}</p>
                        <p className="text-[11px] text-muted">{t("inv.valued_at", { date: date(h.valuedAt!) })}</p>
                      </>}
                    </td>
                    <td className={`num p-3 text-right ${h.unrealized && h.unrealized < 0 ? "text-neg" : h.unrealized ? "text-pos" : ""}`}>{h.unrealized === null ? "—" : money(h.unrealized, h.currency, { sign: true })}</td>
                    <td className="num p-3 text-right">{money(h.income, h.currency)}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <button className="btn btn-soft btn-sm" onClick={() => open("tx", { prefill: { type: "investment_purchase", toAccountId: h.accountId, holdingId: h.id, currency: h.currency }, onSaved: () => mutate() })}>{t("inv.buy")}</button>
                        <button className="btn btn-soft btn-sm" onClick={() => open("tx", { prefill: { type: "investment_sale", fromAccountId: h.accountId, holdingId: h.id, currency: h.currency }, onSaved: () => mutate() })}>{t("inv.sell")}</button>
                        <button className="btn btn-soft btn-sm" onClick={() => setValuing(h)}>{t("inv.update_value")}</button>
                        <button className="btn btn-ghost btn-sm !px-2" onClick={() => setForm(h)} aria-label={t("common.edit")}><Pencil size={14} /></button>
                        <button className="btn btn-ghost btn-sm !px-2" aria-label={t("common.delete")} onClick={async () => { if (await confirm(t("common.are_you_sure"))) { try { await api(`/api/holdings/${h.id}`, { method: "DELETE" }); mutate(); } catch (e) { toast(errorText(t, e), { tone: "error" }); } } }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      <p className="text-xs text-muted">{t("tx.type.investment_purchase")} / {t("tx.type.investment_sale")} → <Link className="text-brand" href="/transactions?type=investment_purchase">{t("nav.transactions")}</Link></p>
      {form && <HoldingForm initial={form} onClose={() => setForm(null)} onSaved={() => mutate()} />}
      {valuing && <ValuationForm h={valuing} onClose={() => setValuing(null)} onSaved={() => mutate()} />}
    </div>
  );
}

function HoldingForm({ initial, onClose, onSaved }: { initial: Partial<Holding>; onClose: () => void; onSaved: () => void }) {
  const { t, activeAccounts } = useApp();
  const [name, setName] = useState(initial.name ?? "");
  const [symbol, setSymbol] = useState(initial.symbol ?? "");
  const [assetType, setAssetType] = useState(initial.assetType ?? "fund");
  const [accountId, setAccountId] = useState(initial.accountId ?? "");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (initial.id) await api(`/api/holdings/${initial.id}`, { method: "PATCH", body: { name, symbol: symbol || null, assetType } });
      else await api("/api/holdings", { body: { name, symbol: symbol || null, assetType, accountId } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    }
  }
  return (
    <Modal open onClose={onClose} title={initial.id ? t("common.edit") : t("inv.add")}
      footer={<><button className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button><button form="h-form" className="btn btn-primary">{t("common.save")}</button></>}>
      <form id="h-form" onSubmit={submit} className="space-y-4">
        <Field label={t("common.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("inv.symbol")}><input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} /></Field>
          <Field label={t("inv.asset_type")}>
            <select className="input" value={assetType} onChange={(e) => setAssetType(e.target.value)}>{ASSET_TYPES.map((a) => <option key={a} value={a}>{t(`inv.asset.${a}` as Key)}</option>)}</select>
          </Field>
        </div>
        {!initial.id && (
          <Field label={t("tx.account")}>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{activeAccounts.filter((a) => a.type === "investment").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </Field>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
    </Modal>
  );
}

function ValuationForm({ h, onClose, onSaved }: { h: Holding; onClose: () => void; onSaved: () => void }) {
  const { t, me } = useApp();
  const [value, setValue] = useState(h.marketValue !== null ? toDecimalString(h.marketValue, h.currency) : "");
  const [date, setDate] = useState(todayIn(me?.settings.timezone ?? "Asia/Vientiane"));
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = parseAmount(value, h.currency);
    if (v === null || v < 0) return setError(t("inv.value") + "?");
    try {
      await api(`/api/holdings/${h.id}`, { method: "PATCH", body: { marketValue: v, valuedAt: date } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    }
  }
  return (
    <Modal open onClose={onClose} title={`${t("inv.update_value")} · ${h.name}`}
      footer={<><button className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button><button form="v-form" className="btn btn-primary">{t("common.save")}</button></>}>
      <form id="v-form" onSubmit={submit} className="space-y-4">
        <Field label={`${t("inv.value")} (${h.currency})`} hint={`${t("inv.units")}: ${h.units}`}><input className="input num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required /></Field>
        <Field label={t("common.date")}><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
    </Modal>
  );
}
