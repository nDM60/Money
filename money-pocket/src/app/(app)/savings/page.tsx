"use client";
import { useState } from "react";
import useSWR from "swr";
import { Plus, Pencil, Trash2, CheckCircle2, ArrowDownRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { useApp } from "@/client/app";
import { api, fetcher } from "@/client/api";
import type { Transaction } from "@/client/types";
import { Badge, Card, Empty, Loading, Meter, PageHeader } from "@/components/ui";
import { TxRow } from "@/components/tx-list";

interface Goal { id: string; name: string; targetAmount: number; currency: string; accountId: string | null; targetDate: string | null; color: string; completedAt: string | null; current: number; progress: number; monthlyNeeded: number | null }

export default function SavingsPage() {
  const { t, money, date, open, accountName, confirm, refresh } = useApp();
  const { data, mutate } = useSWR<Goal[]>("/api/goals", fetcher);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!data) return <Loading />;
  const saved = data.reduce<Record<string, number>>((a, g) => ({ ...a, [g.currency]: (a[g.currency] ?? 0) + Math.max(0, g.current) }), {});
  return (
    <div>
      <PageHeader title={t("goals.title")} subtitle={Object.entries(saved).map(([c, v]) => `${t("goals.saved")}: ${money(v, c)}`).join(" · ")}
        actions={<button className="btn btn-primary" onClick={() => open("goal", {})}><Plus size={16} />{t("goals.add")}</button>} />
      {data.length === 0 ? <Card><Empty title={t("goals.empty")} action={<button className="btn btn-primary" onClick={() => open("goal", {})}>{t("goals.add")}</button>} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((g) => (
            <Card key={g.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-bold text-white" style={{ background: g.color }}>{Math.round(g.progress * 100)}%</div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold">{g.name}{g.completedAt && <Badge tone="good"><CheckCircle2 size={12} />{t("goals.completed")}</Badge>}</p>
                  <p className="text-xs text-muted">{g.accountId ? accountName(g.accountId) : "—"}{g.targetDate ? ` · ${t("goals.target_date")}: ${date(g.targetDate)}` : ""}</p>
                </div>
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => open("goal", { existing: g as unknown as Record<string, unknown> })} aria-label={t("common.edit")}><Pencil size={15} /></button>
                <button className="btn btn-ghost btn-sm !px-2" onClick={async () => { if (await confirm(t("common.are_you_sure"))) { await api(`/api/goals/${g.id}`, { method: "DELETE" }); mutate(); refresh(); } }} aria-label={t("common.delete")}><Trash2 size={15} /></button>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <p className="num text-2xl font-bold">{money(g.current, g.currency)}</p>
                <p className="num text-sm text-muted">/ {money(g.targetAmount, g.currency)}</p>
              </div>
              <div className="mt-2"><Meter value={g.progress} color="var(--savings)" label={g.name} /></div>
              <p className="mt-2 text-xs text-muted">
                {g.current < g.targetAmount ? t("goals.remaining", { amount: money(g.targetAmount - g.current, g.currency) }) : ""}
                {g.monthlyNeeded ? ` · ${t("goals.monthly_needed", { amount: money(g.monthlyNeeded, g.currency) })}` : ""}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn btn-soft btn-sm" onClick={() => open("tx", { prefill: { type: "savings_contribution", toAccountId: g.accountId, goalId: g.id, currency: g.currency }, onSaved: () => mutate() })}><ArrowDownRight size={15} />{t("goals.contribute")}</button>
                <button className="btn btn-soft btn-sm" onClick={() => open("tx", { prefill: { type: "transfer", fromAccountId: g.accountId, goalId: g.id, currency: g.currency }, onSaved: () => mutate() })}><ArrowUpRight size={15} />{t("goals.withdraw")}</button>
                <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setExpanded(expanded === g.id ? null : g.id)} aria-expanded={expanded === g.id}>{t("goals.activity")}<ChevronDown size={14} /></button>
              </div>
              {expanded === g.id && <Activity id={g.id} accountId={g.accountId ?? undefined} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Activity({ id, accountId }: { id: string; accountId?: string }) {
  const { t } = useApp();
  const { data } = useSWR<Transaction[]>(`/api/goals/${id}`, fetcher);
  if (!data) return <Loading />;
  if (!data.length) return <p className="mt-3 text-sm text-muted">{t("tx.empty")}</p>;
  return <div className="-mx-2 mt-3 border-t border-line pt-2">{data.slice(0, 10).map((x) => <TxRow key={x.id} tx={x} accountId={accountId} />)}</div>;
}
