"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { ChevronLeft, Pencil, Archive, Trash2, Scale, Plus, Printer } from "lucide-react";
import { useApp, errorText } from "@/client/app";
import { api, fetcher } from "@/client/api";
import type { Account, Transaction } from "@/client/types";
import { Badge, Card, Empty, Field, Loading, Modal, SectionTitle } from "@/components/ui";
import { IconTile } from "@/components/icon";
import { TxRow } from "@/components/tx-list";
import { parseAmount, toDecimalString } from "@/lib/money";
import { startOfMonth, todayIn } from "@/lib/dates";
import type { Key } from "@/lib/i18n";

interface Statement {
  account: Account; start: string; end: string; opening: number; closing: number;
  lines: (Transaction & { delta: number; balance: number })[];
  snapshots: { id: string; kind: string; actualBalance: number; calculatedBalance: number; difference: number; effectiveDate: string; note: string | null }[];
}

export default function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, me, accounts, money, date, open, refresh, toast, confirm } = useApp();
  const router = useRouter();
  const today = todayIn(me?.settings.timezone ?? "Asia/Vientiane");
  const [start, setStart] = useState(startOfMonth(today));
  const [end, setEnd] = useState(today);
  const { data, mutate } = useSWR<Statement>(`/api/accounts/${id}/statement?start=${start}&end=${end}`, fetcher);
  const [reconcile, setReconcile] = useState(false);
  const acc = accounts.find((a) => a.id === id);

  if (!data || !acc) return <Loading />;
  const reload = () => { mutate(); };

  async function archive() {
    await api(`/api/accounts/${id}`, { method: "PATCH", body: { status: acc!.status === "active" ? "archived" : "active" } });
    await refresh();
  }
  async function remove() {
    if (!(await confirm(t("common.are_you_sure")))) return;
    try {
      await api(`/api/accounts/${id}`, { method: "DELETE" });
      await refresh();
      router.replace("/accounts");
    } catch (e) {
      toast((e as { code?: string }).code === "account_has_transactions" ? t("acc.delete_blocked") : errorText(t, e), { tone: "error" });
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/accounts" className="no-print inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft size={16} />{t("nav.accounts")}</Link>
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-4">
          <IconTile name={acc.icon} color={acc.color} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{acc.name} {acc.status === "archived" && <Badge>{t("acc.archived")}</Badge>}</h1>
            <p className="text-sm text-muted">{t(`acc.type.${acc.type}` as Key)}{acc.institution ? ` · ${acc.institution}` : ""} · {acc.currency}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">{t("acc.current_balance")}</p>
            <p className={`num text-3xl font-bold ${acc.balance < 0 ? "text-neg" : ""}`}>{money(acc.balance, acc.currency)}</p>
            <p className="num text-xs text-muted">{t("acc.opening")}: {money(acc.openingBalance, acc.currency)} · {date(acc.openingDate)}</p>
          </div>
        </div>
        <div className="no-print mt-5 flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" onClick={() => setReconcile(true)}><Scale size={15} />{t("acc.reconcile")}</button>
          <button className="btn btn-soft btn-sm" onClick={() => open("tx", { prefill: { type: "expense", fromAccountId: id }, onSaved: reload })}><Plus size={15} />{t("tx.add")}</button>
          <button className="btn btn-soft btn-sm" onClick={() => open("account", { existing: acc })}><Pencil size={15} />{t("common.edit")}</button>
          <button className="btn btn-soft btn-sm" onClick={archive}><Archive size={15} />{acc.status === "active" ? t("common.archive") : t("common.unarchive")}</button>
          <button className="btn btn-danger btn-sm" onClick={remove}><Trash2 size={15} />{t("common.delete")}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={15} />{t("common.print")}</button>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <SectionTitle title={t("acc.statement")} action={
            <div className="flex items-center gap-1.5">
              <input type="date" className="input !w-auto !py-1 text-xs" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t("common.start")} />
              <input type="date" className="input !w-auto !py-1 text-xs" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t("common.end")} />
            </div>} />
          <div className="mb-2 flex justify-between rounded-xl bg-card-2 px-3 py-2 text-sm"><span className="text-muted">{t("rep.opening_balance")} · {date(data.start)}</span><span className="num font-semibold">{money(data.opening, acc.currency)}</span></div>
          {data.lines.length === 0 ? <Empty title={t("tx.empty")} /> : (
            <div className="-mx-2">
              {[...data.lines].reverse().map((l) => (
                <div key={l.id} className="flex items-center">
                  <div className="min-w-0 flex-1"><TxRow tx={l} accountId={id} onChange={reload} /></div>
                  <span className="num hidden w-36 shrink-0 pr-2 text-right text-xs text-muted sm:block">{money(l.balance, acc.currency)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex justify-between rounded-xl bg-card-2 px-3 py-2 text-sm"><span className="text-muted">{t("rep.closing_balance")} · {date(data.end)}</span><span className="num font-semibold">{money(data.closing, acc.currency)}</span></div>
        </Card>
        <Card className="h-fit p-5">
          <SectionTitle title={t("acc.snapshots")} />
          <ul className="space-y-3">
            {data.snapshots.map((s) => (
              <li key={s.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex justify-between"><span className="font-medium">{t(`acc.snapshot.${s.kind}` as Key)}</span><span className="text-xs text-muted">{date(s.effectiveDate)}</span></div>
                <p className="num mt-1">{money(s.actualBalance, acc.currency)}</p>
                {s.kind === "reconciliation" && (
                  <p className="num text-xs text-muted">{t("acc.calculated")}: {money(s.calculatedBalance, acc.currency)} · {t("acc.difference")}: <span className={s.difference ? "font-semibold text-warn" : ""}>{money(s.difference, acc.currency, { sign: true })}</span></p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {reconcile && <ReconcileModal account={acc} onClose={() => setReconcile(false)} onDone={reload} />}
    </div>
  );
}

function ReconcileModal({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => void }) {
  const { t, me, money, refresh, toast } = useApp();
  const [value, setValue] = useState(toDecimalString(account.balance, account.currency));
  const [date, setDate] = useState(todayIn(me?.settings.timezone ?? "Asia/Vientiane"));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const actual = parseAmount(value, account.currency);
  const diff = actual === null ? null : actual - account.balance;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (actual === null) return;
    try {
      const r = await api<{ difference: number }>(`/api/accounts/${account.id}/reconcile`, { body: { actualBalance: actual, date, note: note || null } });
      toast(r.difference === 0 ? t("acc.in_sync") : t("acc.reconciled"), { tone: "ok" });
      await refresh();
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    }
  }
  return (
    <Modal open onClose={onClose} title={t("acc.reconcile")}
      footer={<><button className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button><button form="rec-form" className="btn btn-primary">{t("common.confirm")}</button></>}>
      <form id="rec-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-2">{t("acc.reconcile_hint")}</p>
        <Field label={`${t("acc.actual_balance")} (${account.currency})`}><input className="input num text-lg font-semibold" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label={t("common.date")}><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t("common.notes")}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-card-2 p-3 text-sm">
          <span className="text-muted">{t("acc.calculated")}</span><span className="num text-right">{money(account.balance, account.currency)}</span>
          <span className="text-muted">{t("acc.difference")}</span><span className={`num text-right font-semibold ${diff ? "text-warn" : ""}`}>{diff === null ? "—" : money(diff, account.currency, { sign: true })}</span>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
    </Modal>
  );
}
