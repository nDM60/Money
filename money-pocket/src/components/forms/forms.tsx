"use client";
import { useState } from "react";
import clsx from "clsx";
import { useApp, errorText } from "@/client/app";
import { api } from "@/client/api";
import type { Account } from "@/client/types";
import { Field, Modal, Toggle } from "../ui";
import { IconTile, ICON_NAMES } from "../icon";
import { ACCOUNT_TYPES, BUDGET_PERIODS, COLORS, LIABILITY_TYPES } from "@/lib/domain";
import { CURRENCY_CODES, parseAmount, toDecimalString } from "@/lib/money";
import { todayIn } from "@/lib/dates";
import type { Key } from "@/lib/i18n";

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} aria-pressed={value === c}
          className={clsx("h-7 w-7 rounded-full ring-offset-2 ring-offset-[var(--card)] transition", value === c && "ring-2 ring-[var(--ink)]")} style={{ background: c }} />
      ))}
    </div>
  );
}

function IconPicker({ value, onChange, color }: { value: string; onChange: (c: string) => void; color: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ICON_NAMES.map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={n} aria-pressed={value === n}
          className={clsx("rounded-xl p-0.5", value === n && "ring-2 ring-[var(--ink)]")}>
          <IconTile name={n} color={value === n ? color : "#94a3b8"} size={32} />
        </button>
      ))}
    </div>
  );
}

export function AccountForm({ prefill, existing, onClose }: { prefill?: Partial<Account>; existing?: Account; onClose: () => void }) {
  const { t, currency, refresh, toast, me } = useApp();
  const init = existing ?? prefill ?? {};
  const [name, setName] = useState(init.name ?? "");
  const [type, setType] = useState<string>(init.type ?? "bank");
  const [institution, setInstitution] = useState(init.institution ?? "");
  const [cur, setCur] = useState(init.currency ?? currency);
  const [opening, setOpening] = useState(init.openingBalance ? toDecimalString(init.openingBalance, init.currency ?? currency) : "");
  const [openingDate, setOpeningDate] = useState(init.openingDate ?? todayIn(me?.settings.timezone ?? "Asia/Vientiane"));
  const [color, setColor] = useState(init.color ?? COLORS[0]);
  const [icon, setIcon] = useState(init.icon ?? "wallet");
  const [notes, setNotes] = useState(init.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const openingBalance = opening.trim() === "" ? 0 : parseAmount(opening, cur);
    if (openingBalance === null) return setError(t("acc.opening_balance") + "?");
    setSaving(true);
    setError(null);
    try {
      const body = { name, type, institution: institution || null, currency: cur, openingBalance, openingDate, color, icon, notes: notes || null };
      if (existing) await api(`/api/accounts/${existing.id}`, { method: "PATCH", body });
      else await api("/api/accounts", { body });
      toast(existing ? t("common.saved") : t("acc.created"), { tone: "ok" });
      await refresh();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={existing ? t("acc.edit") : t("acc.add")}
      footer={<><button className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button><button form="acc-form" className="btn btn-primary" disabled={saving}>{saving ? t("common.saving") : t("common.save")}</button></>}>
      <form id="acc-form" onSubmit={submit} className="space-y-4">
        <Field label={t("common.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.type")}>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {ACCOUNT_TYPES.map((x) => <option key={x} value={x}>{t(`acc.type.${x}` as Key)}</option>)}
            </select>
          </Field>
          <Field label={t("common.currency")}>
            <select className="input" value={cur} onChange={(e) => setCur(e.target.value)}>
              {CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label={<>{t("acc.institution")} <span className="font-normal text-muted">({t("common.optional")})</span></>}>
          <input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={80} />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={t("acc.opening_balance")} hint={(LIABILITY_TYPES as string[]).includes(type) ? t("acc.liability_hint") : t("acc.opening_balance_hint")}>
            <input className="input num text-lg font-semibold" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
          </Field>
          <Field label={t("acc.opening_date")}><input type="date" className="input" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} required /></Field>
        </div>
        <Field label={t("common.color")}><ColorPicker value={color} onChange={setColor} /></Field>
        <Field label={t("common.icon")}><IconPicker value={icon} onChange={setIcon} color={color} /></Field>
        <Field label={t("common.notes")}><textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
        {error && <p className="text-sm font-medium text-bad" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

export function BudgetForm({ prefill, existing, onClose }: { prefill?: Record<string, unknown>; existing?: Record<string, unknown>; onClose: () => void }) {
  const { t, currency, categories, catLabel, refresh, toast } = useApp();
  const init = (existing ?? prefill ?? {}) as { categoryId?: string | null; period?: string; amount?: number | null; currency?: string; rollover?: boolean; thresholds?: number[]; id?: string };
  const cur = init.currency ?? currency;
  const [categoryId, setCategoryId] = useState(init.categoryId ?? "");
  const [period, setPeriod] = useState(init.period ?? "monthly");
  const [amount, setAmount] = useState(init.amount ? toDecimalString(init.amount, cur) : "");
  const [rollover, setRollover] = useState(init.rollover ?? false);
  const [thresholds, setThresholds] = useState((init.thresholds ?? [80, 90, 100]).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseAmount(amount, cur);
    if (!amt) return setError(t("budgets.limit") + "?");
    setSaving(true);
    try {
      const body = { categoryId: categoryId || null, period, amount: amt, currency: cur, rollover, thresholds: thresholds.split(",").map((x) => parseInt(x)).filter((x) => x > 0 && x <= 200) };
      if (existing?.id) await api(`/api/budgets/${existing.id}`, { method: "PATCH", body });
      else await api("/api/budgets", { body });
      toast(t("common.saved"), { tone: "ok" });
      await refresh();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={existing ? t("budgets.edit") : t("budgets.add")}
      footer={<><button className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button><button form="budget-form" className="btn btn-primary" disabled={saving}>{t("common.save")}</button></>}>
      <form id="budget-form" onSubmit={submit} className="space-y-4">
        <Field label={t("budgets.category")}>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("budgets.overall")}</option>
            {categories.filter((c) => c.kind === "expense" && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.parentId ? "↳ " : ""}{catLabel(c)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("budgets.period")}>
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {BUDGET_PERIODS.map((p) => <option key={p} value={p}>{t(`period.${p}` as Key)}</option>)}
            </select>
          </Field>
          <Field label={`${t("budgets.limit")} (${cur})`}>
            <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
        </div>
        <Field label={t("budgets.alerts")} hint="%"><input className="input" value={thresholds} onChange={(e) => setThresholds(e.target.value)} /></Field>
        <Toggle checked={rollover} onChange={setRollover} label={t("budgets.rollover")} hint={t("budgets.rollover_hint")} />
        {error && <p className="text-sm font-medium text-bad" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

export function GoalForm({ prefill, existing, onClose }: { prefill?: Record<string, unknown>; existing?: Record<string, unknown>; onClose: () => void }) {
  const { t, currency, activeAccounts, refresh, toast } = useApp();
  const init = (existing ?? prefill ?? {}) as { id?: string; name?: string; targetAmount?: number; currency?: string; accountId?: string | null; targetDate?: string | null; color?: string };
  const [name, setName] = useState(init.name ?? "");
  const [cur, setCur] = useState(init.currency ?? currency);
  const [target, setTarget] = useState(init.targetAmount ? toDecimalString(init.targetAmount, init.currency ?? currency) : "");
  const [accountId, setAccountId] = useState(init.accountId ?? "");
  const [targetDate, setTargetDate] = useState(init.targetDate ?? "");
  const [color, setColor] = useState(init.color ?? "#1d4ed8");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const linkable = activeAccounts.filter((a) => a.currency === cur);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseAmount(target, cur);
    if (!amt) return setError(t("goals.target") + "?");
    setSaving(true);
    try {
      const body = { name, targetAmount: amt, currency: cur, accountId: accountId || null, targetDate: targetDate || null, color };
      if (init.id && existing) await api(`/api/goals/${init.id}`, { method: "PATCH", body });
      else await api("/api/goals", { body });
      toast(t("common.saved"), { tone: "ok" });
      await refresh();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={existing ? t("goals.edit") : t("goals.add")}
      footer={<><button className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button><button form="goal-form" className="btn btn-primary" disabled={saving}>{t("common.save")}</button></>}>
      <form id="goal-form" onSubmit={submit} className="space-y-4">
        <Field label={t("common.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={t("goals.target")}><input className="input num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} required /></Field>
          <Field label={t("common.currency")}>
            <select className="input !w-24" value={cur} onChange={(e) => { setCur(e.target.value); setAccountId(""); }}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
        </div>
        <Field label={t("goals.account")} hint={t("goals.account_hint")}>
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t("common.none")}</option>
            {linkable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label={<>{t("goals.target_date")} <span className="font-normal text-muted">({t("common.optional")})</span></>}>
          <input type="date" className="input" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
        <Field label={t("common.color")}><ColorPicker value={color} onChange={setColor} /></Field>
        {error && <p className="text-sm font-medium text-bad" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

export { ColorPicker, IconPicker };
