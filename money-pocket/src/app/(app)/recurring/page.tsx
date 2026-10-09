"use client";
import { useState } from "react";
import useSWR from "swr";
import { Plus, Pencil, Trash2, Check, SkipForward } from "lucide-react";
import { useApp, errorText } from "@/client/app";
import { api, fetcher } from "@/client/api";
import { Badge, Card, Empty, Field, Loading, Modal, PageHeader, Toggle } from "@/components/ui";
import { RECURRING_FREQ, TX_SHAPE, USER_TX_TYPES, type TxType } from "@/lib/domain";
import { CURRENCY_CODES, parseAmount, toDecimalString } from "@/lib/money";
import { todayIn } from "@/lib/dates";
import type { Key } from "@/lib/i18n";

interface Rule {
  id: string; name: string; type: string; amount: number; currency: string; fromAccountId: string | null; toAccountId: string | null; categoryId: string | null;
  frequency: string; startDate: string; endDate: string | null; nextDueDate: string; reminderDaysBefore: number; autoPost: boolean; active: boolean;
  status: "overdue" | "due" | "upcoming" | "scheduled" | "inactive";
}
const TONE = { overdue: "bad", due: "warn", upcoming: "brand", scheduled: "neutral", inactive: "neutral" } as const;

export default function RecurringPage() {
  const { t, money, date, accountName, categories, catLabel, refresh, toast, confirm } = useApp();
  const { data, mutate } = useSWR<Rule[]>("/api/recurring", fetcher);
  const [edit, setEdit] = useState<Partial<Rule> | null>(null);
  if (!data) return <Loading />;
  async function post(r: Rule, skip = false) {
    try {
      await api(`/api/recurring/${r.id}/post`, { body: skip ? { skip: true } : {} });
      toast(skip ? t("rec.skip") : t("rec.posted"), { tone: "ok" });
      mutate();
      refresh();
    } catch (e) {
      toast(errorText(t, e), { tone: "error" });
    }
  }
  return (
    <div>
      <PageHeader title={t("rec.title")} actions={<button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />{t("rec.add")}</button>} />
      <Card className="p-2">
        {data.length === 0 ? <Empty title={t("rec.empty")} /> : (
          <ul className="divide-y divide-line">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">{r.name} <Badge tone={TONE[r.status]}>{t(`rec.status.${r.status}` as Key)}</Badge>{r.autoPost && <Badge>auto</Badge>}</p>
                  <p className="text-xs text-muted">
                    {t(`period.${r.frequency}` as Key)} · {t("rec.next_due")}: {date(r.nextDueDate)} · {accountName(r.fromAccountId ?? r.toAccountId)}
                    {r.categoryId ? ` · ${catLabel(categories.find((c) => c.id === r.categoryId))}` : ""}
                  </p>
                </div>
                <p className={`num font-semibold ${TX_SHAPE[r.type as TxType]?.report === "income" ? "text-pos" : ""}`}>{money(r.amount, r.currency)}</p>
                <div className="flex gap-1">
                  {r.active && <button className="btn btn-primary btn-sm" onClick={() => post(r)}><Check size={14} />{t("rec.post")}</button>}
                  {r.active && <button className="btn btn-soft btn-sm" onClick={() => post(r, true)}><SkipForward size={14} />{t("rec.skip")}</button>}
                  <button className="btn btn-ghost btn-sm !px-2" onClick={() => setEdit(r)} aria-label={t("common.edit")}><Pencil size={14} /></button>
                  <button className="btn btn-ghost btn-sm !px-2" aria-label={t("common.delete")} onClick={async () => { if (await confirm(t("common.are_you_sure"))) { await api(`/api/recurring/${r.id}`, { method: "DELETE" }); mutate(); } }}><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <RuleForm initial={edit} onClose={() => setEdit(null)} onSaved={() => mutate()} />}
    </div>
  );
}

function RuleForm({ initial, onClose, onSaved }: { initial: Partial<Rule>; onClose: () => void; onSaved: () => void }) {
  const { t, me, currency, activeAccounts, categories, catLabel } = useApp();
  const [name, setName] = useState(initial.name ?? "");
  const [type, setType] = useState<TxType>((initial.type as TxType) ?? "expense");
  const [cur, setCur] = useState(initial.currency ?? currency);
  const [amount, setAmount] = useState(initial.amount ? toDecimalString(initial.amount, initial.currency ?? currency) : "");
  const [fromId, setFromId] = useState(initial.fromAccountId ?? activeAccounts[0]?.id ?? "");
  const [toId, setToId] = useState(initial.toAccountId ?? activeAccounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "");
  const [frequency, setFrequency] = useState(initial.frequency ?? "monthly");
  const [startDate, setStartDate] = useState(initial.nextDueDate ?? todayIn(me?.settings.timezone ?? "Asia/Vientiane"));
  const [endDate, setEndDate] = useState(initial.endDate ?? "");
  const [reminder, setReminder] = useState(initial.reminderDaysBefore ?? 1);
  const [autoPost, setAutoPost] = useState(initial.autoPost ?? false);
  const [error, setError] = useState<string | null>(null);
  const shape = TX_SHAPE[type];
  const kind = shape.report === "income" ? "income" : shape.report === "expense" ? "expense" : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseAmount(amount, cur);
    if (!amt) return setError(t("common.amount") + "?");
    const body = {
      name, type, amount: amt, currency: cur, frequency, startDate, endDate: endDate || null, reminderDaysBefore: reminder, autoPost,
      fromAccountId: shape.from === "required" ? fromId : null, toAccountId: shape.to === "required" ? toId : null, categoryId: kind ? categoryId || null : null,
    };
    try {
      if (initial.id) await api(`/api/recurring/${initial.id}`, { method: "PATCH", body });
      else await api("/api/recurring", { body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    }
  }
  return (
    <Modal open onClose={onClose} title={initial.id ? t("common.edit") : t("rec.add")}
      footer={<><button className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button><button form="r-form" className="btn btn-primary">{t("common.save")}</button></>}>
      <form id="r-form" onSubmit={submit} className="space-y-4">
        <Field label={t("common.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.type")}>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as TxType)}>{USER_TX_TYPES.filter((x) => TX_SHAPE[x].from !== "either").map((x) => <option key={x} value={x}>{t(`tx.type.${x}` as Key)}</option>)}</select>
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label={t("common.amount")}><input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
            <Field label=" "><select className="input !w-20" value={cur} onChange={(e) => setCur(e.target.value)} aria-label={t("common.currency")}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {shape.from === "required" && <Field label={t("tx.from_account")}><select className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}>{activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          {shape.to === "required" && <Field label={t("tx.to_account")}><select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>{activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          {kind && <Field label={t("tx.category")}><select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">{t("common.uncategorized")}</option>{categories.filter((c) => c.kind === kind && !c.archived).map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}</select></Field>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("rec.frequency")}><select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>{RECURRING_FREQ.map((f) => <option key={f} value={f}>{t(`period.${f}` as Key)}</option>)}</select></Field>
          <Field label={t("rec.reminder")}><input type="number" min={0} max={30} className="input" value={reminder} onChange={(e) => setReminder(Number(e.target.value))} /></Field>
          <Field label={initial.id ? t("rec.next_due") : t("rec.start")}><input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></Field>
          <Field label={<>{t("rec.end")} <span className="font-normal text-muted">({t("common.optional")})</span></>}><input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
        <Toggle checked={autoPost} onChange={setAutoPost} label={t("rec.auto_post")} hint={t("rec.auto_post_hint")} />
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
    </Modal>
  );
}
