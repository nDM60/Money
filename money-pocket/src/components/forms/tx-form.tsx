"use client";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { ChevronDown, AlertTriangle, Info } from "lucide-react";
import { useApp, errorText, type TxPrefill } from "@/client/app";
import { api, ApiError, fetcher } from "@/client/api";
import type { Transaction } from "@/client/types";
import { Field, Modal, Segmented } from "../ui";
import { TX_SHAPE, USER_TX_TYPES, PAYMENT_METHODS, RECURRING_FREQ, type TxType } from "@/lib/domain";
import { CURRENCY_CODES, parseAmount, toDecimalString } from "@/lib/money";
import { todayIn } from "@/lib/dates";
import type { Key } from "@/lib/i18n";

interface Props {
  prefill?: TxPrefill;
  existing?: Transaction;
  onClose: () => void;
  onSaved?: (t: Transaction) => void;
}

export function TxForm({ prefill, existing, onClose, onSaved }: Props) {
  const { t, me, activeAccounts, accounts, categories, catLabel, currency: primary, refresh, toast, money } = useApp();
  const tz = me?.settings.timezone ?? "Asia/Vientiane";
  const init = existing
    ? {
        type: existing.type, amount: existing.amount, currency: existing.currency, fromAccountId: existing.fromAccountId, toAccountId: existing.toAccountId,
        categoryId: existing.categoryId, description: existing.description, merchant: existing.merchant, date: existing.localDate,
        paymentMethod: existing.paymentMethod, notes: existing.notes, tags: existing.tags, goalId: existing.goalId, holdingId: existing.holdingId, units: existing.units,
        receiptId: existing.receiptId, fromAmount: existing.fromAmount, toAmount: existing.toAmount,
      }
    : { ...prefill };
  const [type, setType] = useState<TxType>((init.type as TxType) ?? "expense");
  const [currency, setCurrency] = useState<string>(init.currency ?? "");
  const [amountText, setAmountText] = useState(init.amount ? toDecimalString(init.amount, init.currency ?? primary) : "");
  const [fromId, setFromId] = useState<string>(init.fromAccountId ?? "");
  const [toId, setToId] = useState<string>(init.toAccountId ?? "");
  const [adjDir, setAdjDir] = useState<"in" | "out">(existing && existing.type === "adjustment" && existing.fromAccountId ? "out" : "in");
  const [categoryId, setCategoryId] = useState<string>(init.categoryId ?? "");
  const [description, setDescription] = useState(init.description ?? "");
  const [merchant, setMerchant] = useState(init.merchant ?? "");
  const [date, setDate] = useState(init.date ?? todayIn(tz));
  const [time, setTime] = useState(prefill?.time ?? "");
  const [paymentMethod, setPaymentMethod] = useState(init.paymentMethod ?? "");
  const [notes, setNotes] = useState(init.notes ?? "");
  const [tags, setTags] = useState((init.tags ?? []).join(", "));
  const [goalId, setGoalId] = useState(init.goalId ?? "");
  const [holdingId, setHoldingId] = useState(init.holdingId ?? "");
  const [units, setUnits] = useState(init.units ?? "");
  const [convText, setConvText] = useState("");
  const [repeat, setRepeat] = useState<"" | (typeof RECURRING_FREQ)[number]>("");
  const [moreOpen, setMoreOpen] = useState(!!(init.merchant || init.notes || prefill?.uncertain?.length));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const uncertain = new Set(prefill?.uncertain ?? []);

  const shape = TX_SHAPE[type];
  const isAdjust = shape.from === "either";
  const needsFrom = shape.from === "required" || (isAdjust && adjDir === "out");
  const needsTo = shape.to === "required" || (isAdjust && adjDir === "in");
  const report = shape.report;
  const kind = report === "income" ? "income" : report === "expense" ? "expense" : null;

  // Sensible default accounts.
  useEffect(() => {
    if (existing) return;
    if (needsFrom && !fromId && activeAccounts[0]) setFromId(activeAccounts.find((a) => a.type !== "savings" && a.type !== "investment")?.id ?? activeAccounts[0].id);
    if (needsTo && !toId && activeAccounts.length) {
      const pref = type === "savings_contribution" ? activeAccounts.find((a) => a.type === "savings") : type === "investment_purchase" ? activeAccounts.find((a) => a.type === "investment") : null;
      const cand = pref ?? activeAccounts.find((a) => a.id !== fromId);
      if (cand) setToId(cand.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, adjDir, activeAccounts.length]);

  const fromAcc = accounts.find((a) => a.id === fromId);
  const toAcc = accounts.find((a) => a.id === toId);
  const mainAcc = needsFrom ? fromAcc : toAcc;
  const cur = currency || mainAcc?.currency || primary;
  const amount = parseAmount(amountText, cur);
  // Second currency for cross-currency movements.
  const otherAcc = needsFrom && needsTo ? (toAcc && toAcc.currency !== cur ? toAcc : fromAcc && fromAcc.currency !== cur ? fromAcc : null) : (mainAcc && mainAcc.currency !== cur ? mainAcc : null);

  const cats = categories.filter((c) => c.kind === kind && (!c.archived || c.id === categoryId));
  const { data: goals } = useSWR<{ id: string; name: string; accountId: string | null }[]>(type === "savings_contribution" || goalId ? "/api/goals" : null, fetcher);
  const { data: holdings } = useSWR<{ id: string; name: string; accountId: string; units: string }[]>(type.startsWith("investment") ? "/api/holdings" : null, fetcher);
  const invAccount = type === "investment_purchase" ? toId : type === "investment_sale" ? fromId : null;
  const accHoldings = (holdings ?? []).filter((h) => h.accountId === invAccount);

  const beforeOpening = [needsFrom ? fromAcc : null, needsTo ? toAcc : null].some((a) => a && date < a.openingDate);

  const mainTypes: TxType[] = ["expense", "income", "transfer"];
  const typeLabel = (x: TxType) => t(`tx.type.${x}` as Key);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!amount || amount <= 0) return setError(t("common.amount") + "?");
    const body: Record<string, unknown> = {
      type, amount, currency: cur,
      fromAccountId: needsFrom ? fromId || null : null,
      toAccountId: needsTo ? toId || null : null,
      categoryId: kind ? categoryId || null : null,
      description: description.trim(), merchant: merchant.trim() || null, date, paymentMethod: paymentMethod || null,
      notes: notes.trim() || null, tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
      goalId: goalId || null,
      holdingId: type.startsWith("investment") ? holdingId || null : existing?.holdingId ?? null,
      units: type.startsWith("investment") && holdingId ? units || null : existing?.units ?? null,
      receiptId: init.receiptId ?? null,
    };
    if (time) body.time = time;
    if (otherAcc && convText) {
      const conv = parseAmount(convText, otherAcc.currency);
      if (conv) body[otherAcc.id === toId && needsTo ? "toAmount" : "fromAmount"] = conv;
    }
    setSaving(true);
    try {
      const saved = existing
        ? await api<Transaction>(`/api/transactions/${existing.id}`, { method: "PATCH", body })
        : await api<Transaction>("/api/transactions", { body });
      if (repeat && !existing) {
        await api("/api/recurring", {
          body: {
            name: description || typeLabel(type), type, amount, currency: cur, fromAccountId: body.fromAccountId, toAccountId: body.toAccountId,
            categoryId: body.categoryId, frequency: repeat, startDate: nextDate(date, repeat), reminderDaysBefore: 1, autoPost: false,
          },
        });
      }
      toast(t("tx.saved"), { tone: "ok" });
      await refresh();
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "rate_missing") {
        const m = err.message.match(/([A-Z]{3}) → ([A-Z]{3})/);
        setError(t("tx.rate_missing", { pair: m ? `${m[1]} → ${m[2]}` : "" }));
      } else setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  const accountOptions = (exclude?: string) => activeAccounts.filter((a) => a.id !== exclude).map((a) => (
    <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>
  ));

  return (
    <Modal open onClose={onClose} title={existing ? t("tx.edit") : t("tx.add")}
      footer={<>
        <button type="button" className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button>
        <button type="submit" form="tx-form" className="btn btn-primary" disabled={saving}>{saving ? t("common.saving") : prefill?.receiptId ? t("scan.confirm_save") : t("common.save")}</button>
      </>}>
      <form id="tx-form" onSubmit={submit} className="space-y-4">
        {prefill?.uncertain && (
          <div className="flex gap-2 rounded-xl bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] p-3 text-xs text-ink-2"><AlertTriangle size={16} className="shrink-0 text-warn" />{t("scan.review_hint")}</div>
        )}
        {!!prefill?.duplicates?.length && (
          <div className="rounded-xl border border-warn/40 p-3 text-xs">
            <p className="mb-1 font-semibold text-warn">⚠ {t("scan.possible_duplicates")}</p>
            {prefill.duplicates.map((d) => <p key={d.id} className="text-ink-2">{d.date} · {money(d.amount, d.currency)} · {d.merchant ?? d.description}</p>)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={mainTypes.includes(type) ? type : ("" as TxType)} onChange={(v) => setType(v)} options={mainTypes.map((x) => ({ value: x, label: typeLabel(x) }))} />
          <select className="input !w-auto !py-1.5 text-sm" value={mainTypes.includes(type) ? "" : type} onChange={(e) => e.target.value && setType(e.target.value as TxType)} aria-label={t("common.type")}>
            <option value="">{t("common.more_options")}…</option>
            {USER_TX_TYPES.filter((x) => !mainTypes.includes(x)).map((x) => <option key={x} value={x}>{typeLabel(x)}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={t("common.amount")} warn={uncertain.has("amount") ? t("scan.uncertain") : null}>
            <input className={clsx("input num !text-2xl !font-semibold", uncertain.has("amount") && "warn")} inputMode="decimal" autoComplete="off" placeholder="0"
              value={amountText} onChange={(e) => setAmountText(e.target.value)} required aria-invalid={!!amountText && amount === null} />
          </Field>
          <Field label={t("common.currency")} warn={uncertain.has("currency") ? "?" : null}>
            <select className={clsx("input !w-24", uncertain.has("currency") && "warn")} value={cur} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {isAdjust && (
          <Segmented value={adjDir} onChange={setAdjDir} options={[{ value: "in", label: t("tx.adjust_increase") }, { value: "out", label: t("tx.adjust_decrease") }]} />
        )}

        <div className={clsx("grid gap-3", needsFrom && needsTo && "sm:grid-cols-2")}>
          {needsFrom && (
            <Field label={needsTo ? t("tx.from_account") : t("tx.account")}>
              <select className="input" value={fromId} onChange={(e) => setFromId(e.target.value)} required>
                <option value="" disabled>—</option>
                {accountOptions(needsTo ? toId : undefined)}
              </select>
            </Field>
          )}
          {needsTo && (
            <Field label={needsFrom ? t("tx.to_account") : t("tx.account")}>
              <select className="input" value={toId} onChange={(e) => setToId(e.target.value)} required>
                <option value="" disabled>—</option>
                {accountOptions(needsFrom ? fromId : undefined)}
              </select>
            </Field>
          )}
        </div>

        {otherAcc && (
          <Field label={t(otherAcc.id === toId && needsTo ? "tx.amount_received" : "tx.amount_debited", { currency: otherAcc.currency })} hint={t("set.rates")}>
            <input className="input num" inputMode="decimal" value={convText} onChange={(e) => setConvText(e.target.value)} placeholder="auto" />
          </Field>
        )}

        {report === "internal" && <p className="flex gap-2 text-xs text-muted"><Info size={14} className="shrink-0" />{t("tx.internal_note")}</p>}

        {kind && (
          <Field label={t("tx.category")} warn={uncertain.has("category") ? t("scan.uncertain") : null}>
            <select className={clsx("input", uncertain.has("category") && "warn")} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("common.uncategorized")}</option>
              {cats.filter((c) => !c.parentId).map((c) => (
                <optgroup key={c.id} label={catLabel(c)}>
                  <option value={c.id}>{catLabel(c)}</option>
                  {cats.filter((s) => s.parentId === c.id).map((s) => <option key={s.id} value={s.id}>↳ {catLabel(s)}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        )}

        {type.startsWith("investment") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("tx.holding")}>
              <select className="input" value={holdingId} onChange={(e) => setHoldingId(e.target.value)} disabled={!!existing?.holdingId}>
                <option value="">{t("common.none")}</option>
                {accHoldings.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </Field>
            {holdingId && (
              <Field label={t("tx.units")}>
                <input className="input num" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} required disabled={!!existing?.holdingId} />
              </Field>
            )}
          </div>
        )}

        {(type === "savings_contribution" || type === "transfer" || goalId) && !!goals?.length && (
          <Field label={t("tx.goal")}>
            <select className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">{t("common.none")}</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={t("common.date")} warn={uncertain.has("date") ? t("scan.uncertain") : null}>
            <input type="date" className={clsx("input", uncertain.has("date") && "warn")} value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label={t("common.time")}>
            <input type="time" className="input !w-28" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        {beforeOpening && <p className="text-xs text-warn">⚠ {t("tx.before_opening")}</p>}

        <Field label={t("tx.description")}>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>

        <button type="button" className="flex items-center gap-1 text-sm font-semibold text-brand" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
          <ChevronDown size={16} className={clsx("transition-transform", moreOpen && "rotate-180")} /> {t("tx.more_details")}
        </button>
        {moreOpen && (
          <div className="space-y-4 fade-in">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("tx.merchant")} warn={uncertain.has("merchant") ? t("scan.uncertain") : null}>
                <input className={clsx("input", uncertain.has("merchant") && "warn")} value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={120} />
              </Field>
              <Field label={t("tx.payment_method")}>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{t(`tx.pay.${p}` as Key)}</option>)}
                </select>
              </Field>
            </div>
            <Field label={t("tx.tags")} hint={t("tx.tags_hint")}>
              <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
            <Field label={t("common.notes")}>
              <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </Field>
            {!existing && (
              <Field label={t("tx.repeat")}>
                <select className="input" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                  <option value="">{t("common.none")}</option>
                  {RECURRING_FREQ.map((f) => <option key={f} value={f}>{t(`period.${f}` as Key)}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
        {error && <p className="rounded-xl bg-[color-mix(in_srgb,var(--bad)_10%,transparent)] p-3 text-sm font-medium text-bad" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

function nextDate(d: string, f: string) {
  const x = new Date(d + "T00:00:00Z");
  if (f === "daily") x.setUTCDate(x.getUTCDate() + 1);
  else if (f === "weekly") x.setUTCDate(x.getUTCDate() + 7);
  else if (f === "biweekly") x.setUTCDate(x.getUTCDate() + 14);
  else if (f === "quarterly") x.setUTCMonth(x.getUTCMonth() + 3);
  else if (f === "yearly") x.setUTCFullYear(x.getUTCFullYear() + 1);
  else x.setUTCMonth(x.getUTCMonth() + 1);
  return x.toISOString().slice(0, 10);
}

export function useTxTypeLabel() {
  const { t } = useApp();
  return useMemo(() => (x: string) => t(`tx.type.${x}` as Key), [t]);
}
