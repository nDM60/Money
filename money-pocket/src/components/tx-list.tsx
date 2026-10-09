"use client";
import { Copy, Trash2, ArrowLeftRight, Scale, TrendingUp, Paperclip } from "lucide-react";
import { useApp, errorText } from "@/client/app";
import { api } from "@/client/api";
import type { Transaction } from "@/client/types";
import { TX_SHAPE, type TxType } from "@/lib/domain";
import type { Key } from "@/lib/i18n";
import { IconTile } from "./icon";

export function useTxActions(onChange?: () => void) {
  const { t, toast, refresh, confirm } = useApp();
  return {
    async remove(tx: Transaction) {
      if (!(await confirm(t("tx.confirm_delete")))) return;
      try {
        await api(`/api/transactions/${tx.id}`, { method: "DELETE" });
        await refresh();
        onChange?.();
        toast(t("tx.deleted"), {
          action: {
            label: t("common.undo"),
            onClick: async () => {
              await api(`/api/transactions/${tx.id}/restore`, { method: "POST", body: {} });
              await refresh();
              onChange?.();
            },
          },
        });
      } catch (e) {
        toast(errorText(t, e), { tone: "error" });
      }
    },
    async duplicate(tx: Transaction) {
      try {
        await api(`/api/transactions/${tx.id}/duplicate`, { method: "POST", body: {} });
        await refresh();
        onChange?.();
        toast(t("tx.duplicated"), { tone: "ok" });
      } catch (e) {
        toast(errorText(t, e), { tone: "error" });
      }
    },
  };
}

export function TxRow({ tx, onChange, showDate = true, accountId }: { tx: Transaction; onChange?: () => void; showDate?: boolean; accountId?: string }) {
  const { t, money, date, categories, catLabel, accountName, open, accounts } = useApp();
  const actions = useTxActions(onChange);
  const cat = categories.find((c) => c.id === tx.categoryId);
  const report = TX_SHAPE[tx.type as TxType]?.report;
  const isSystem = tx.type === "valuation" || !!tx.parentId;
  // Sign from the perspective of the books (or of the given account).
  let sign = 0;
  let value = tx.amount;
  let cur = tx.currency;
  if (accountId) {
    if (tx.toAccountId === accountId) { sign = 1; value = tx.toAmount ?? tx.amount; }
    else if (tx.fromAccountId === accountId) { sign = -1; value = tx.fromAmount ?? tx.amount; }
    cur = accounts.find((a) => a.id === accountId)?.currency ?? cur;
  } else if (report === "income") sign = 1;
  else if (report === "expense") sign = -1;
  else if (report === "adjustment" || report === "valuation") sign = tx.toAccountId ? 1 : -1;
  const title = tx.description || tx.merchant || t(`tx.type.${tx.type}` as Key);
  const meta = [
    showDate ? date(tx.localDate, "short") : null,
    report === "income" || report === "expense" ? catLabel(cat) : t(`tx.type.${tx.type}` as Key),
    report === "internal" ? `${accountName(tx.fromAccountId)} → ${accountName(tx.toAccountId)}` : accountName(tx.fromAccountId ?? tx.toAccountId),
  ].filter(Boolean).join(" · ");
  const icon = report === "internal" ? <IconTile name="repeat" color="var(--savings)" /> : report === "adjustment" ? <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-card-2 text-muted"><Scale size={18} /></span>
    : report === "valuation" ? <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-card-2 text-invest"><TrendingUp size={18} /></span>
    : <IconTile name={cat?.icon ?? "circle"} color={cat?.color ?? "#94a3b8"} />;

  return (
    <div className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-card-2">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={isSystem} onClick={() => open("tx", { existing: tx })}>
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
            {title}
            {tx.receiptId && <Paperclip size={12} className="shrink-0 text-muted" aria-label={t("tx.receipt")} />}
            {report === "internal" && <ArrowLeftRight size={12} className="shrink-0 text-muted" />}
          </div>
          <div className="truncate text-xs text-muted">{meta}</div>
        </div>
        <div className={`num shrink-0 text-right text-sm font-semibold ${sign > 0 ? "text-pos" : sign < 0 ? "text-ink" : "text-ink-2"}`}>
          {sign > 0 ? "+" : sign < 0 ? "−" : ""}{money(Math.abs(value), cur)}
        </div>
      </button>
      {!isSystem && (
        <div className="flex shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <button className="btn btn-ghost btn-sm !px-2" onClick={() => actions.duplicate(tx)} aria-label={t("common.duplicate")} title={t("common.duplicate")}><Copy size={15} /></button>
          <button className="btn btn-ghost btn-sm !px-2" onClick={() => actions.remove(tx)} aria-label={t("common.delete")} title={t("common.delete")}><Trash2 size={15} /></button>
        </div>
      )}
    </div>
  );
}
