"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import { useApp, errorText } from "@/client/app";
import { api } from "@/client/api";
import { Card, Field, PageHeader } from "@/components/ui";
import { ACCOUNT_TYPES, COLORS } from "@/lib/domain";
import { CURRENCY_CODES, parseAmount } from "@/lib/money";
import { todayIn } from "@/lib/dates";
import type { Key } from "@/lib/i18n";

interface Row { name: string; type: string; currency: string; balance: string; institution: string }

export default function SetupPage() {
  const { t, me, currency, money, refresh } = useApp();
  const router = useRouter();
  const [date, setDate] = useState(todayIn(me?.settings.timezone ?? "Asia/Vientiane"));
  const [rows, setRows] = useState<Row[]>(() => [
    { name: t("setup.suggest.daily"), type: "bank", currency, balance: "", institution: "" },
    { name: t("setup.suggest.savings"), type: "savings", currency, balance: "", institution: "" },
    { name: t("setup.suggest.investment"), type: "investment", currency, balance: "", institution: "" },
    { name: t("setup.suggest.cash"), type: "cash", currency, balance: "", institution: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totalsByCur = rows.reduce<Record<string, number>>((acc, r) => {
    const v = parseAmount(r.balance || "0", r.currency);
    if (v !== null && r.name.trim()) acc[r.currency] = (acc[r.currency] ?? 0) + v;
    return acc;
  }, {});
  const update = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function finish() {
    setError(null);
    const accounts = [];
    for (const [i, r] of rows.entries()) {
      if (!r.name.trim()) continue;
      const v = parseAmount(r.balance || "0", r.currency);
      if (v === null) return setError(`${r.name}: ${t("acc.opening_balance")}?`);
      accounts.push({ name: r.name.trim(), type: r.type, currency: r.currency, openingBalance: v, institution: r.institution || null, color: COLORS[i % COLORS.length] });
    }
    setSaving(true);
    try {
      await api("/api/accounts/setup", { body: { effectiveDate: date, accounts } });
      await refresh();
      router.replace("/");
    } catch (e) {
      setError(errorText(t, e));
      setSaving(false);
    }
  }

  async function skip() {
    await api("/api/settings", { method: "PATCH", body: { onboarded: true } });
    router.replace("/");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("setup.title")} subtitle={t("setup.subtitle")} />
      <Card className="p-5">
        <div className="mb-4 max-w-xs">
          <Field label={t("setup.effective_date")}><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-card-2 p-3 sm:grid-cols-[1.4fr_1fr_0.7fr_1.2fr_auto] sm:items-end">
              <Field label={t("common.name")}><input className="input" value={r.name} onChange={(e) => update(i, { name: e.target.value })} /></Field>
              <Field label={t("common.type")}>
                <select className="input" value={r.type} onChange={(e) => update(i, { type: e.target.value })}>{ACCOUNT_TYPES.map((x) => <option key={x} value={x}>{t(`acc.type.${x}` as Key)}</option>)}</select>
              </Field>
              <Field label={t("common.currency")}>
                <select className="input" value={r.currency} onChange={(e) => update(i, { currency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
              <Field label={t("acc.opening_balance")}>
                <input className="input num font-semibold" inputMode="decimal" placeholder="0" value={r.balance} onChange={(e) => update(i, { balance: e.target.value })} />
              </Field>
              <button className="btn btn-ghost btn-sm col-span-2 justify-self-end sm:col-span-1" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t("common.delete")}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button className="btn btn-soft mt-3" onClick={() => setRows([...rows, { name: "", type: "bank", currency, balance: "", institution: "" }])}><Plus size={16} />{t("setup.add_row")}</button>

        <div className="mt-6 grid gap-3 rounded-2xl bg-brand-soft p-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-ink-2">{t("setup.total_opening")}</p>
            {Object.keys(totalsByCur).length ? Object.entries(totalsByCur).map(([c, v]) => <p key={c} className="num text-xl font-bold">{money(v, c)}</p>) : <p className="num text-xl font-bold">{money(0)}</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-ink-2">{t("setup.income_recorded")}</p>
            <p className="num text-xl font-bold">{money(0)}</p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-ink-2 sm:col-span-2"><ShieldCheck size={14} className="text-brand" />{t("setup.not_income_note")}</p>
        </div>
        {error && <p className="mt-3 text-sm font-medium text-bad" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={skip}>{t("setup.skip")}</button>
          <button className="btn btn-primary" onClick={finish} disabled={saving}>{saving ? t("common.saving") : t("setup.finish")}</button>
        </div>
      </Card>
    </div>
  );
}
