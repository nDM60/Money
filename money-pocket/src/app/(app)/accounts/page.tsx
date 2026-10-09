"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus, ChevronRight } from "lucide-react";
import { useApp } from "@/client/app";
import { fetcher } from "@/client/api";
import { Card, Empty, PageHeader, Toggle } from "@/components/ui";
import { IconTile } from "@/components/icon";
import type { Key } from "@/lib/i18n";

const GROUPS: { key: "cash" | "savings" | "investment" | "liability" | "other"; types: string[] }[] = [
  { key: "cash", types: ["cash", "bank", "ewallet"] },
  { key: "savings", types: ["savings"] },
  { key: "investment", types: ["investment"] },
  { key: "liability", types: ["credit", "loan"] },
  { key: "other", types: ["other"] },
];

interface Overview { overview: { netWorth: number; availableCash: number }; accounts: { id: string; converted: number | null }[] }

export default function AccountsPage() {
  const { t, accounts, money, open, currency } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const { data } = useSWR<Overview>("/api/dashboard?period=month", fetcher);
  const list = accounts.filter((a) => showArchived || a.status === "active");
  const conv = new Map(data?.accounts.map((a) => [a.id, a.converted]) ?? []);

  return (
    <div>
      <PageHeader title={t("nav.accounts")} subtitle={data ? `${t("dash.net_worth")}: ${money(data.overview.netWorth)}` : undefined}
        actions={<button className="btn btn-primary" onClick={() => open("account", {})}><Plus size={16} />{t("acc.add")}</button>} />
      {accounts.length === 0 ? (
        <Card><Empty title={t("acc.empty")} action={<Link href="/setup" className="btn btn-primary">{t("dash.empty_cta")}</Link>} /></Card>
      ) : (
        <div className="space-y-6">
          {GROUPS.map((g) => {
            const items = list.filter((a) => g.types.includes(a.type));
            if (!items.length) return null;
            const total = items.reduce((s, a) => s + (a.status === "active" ? conv.get(a.id) ?? (a.currency === currency ? a.balance : 0) : 0), 0);
            return (
              <section key={g.key}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold text-ink-2">{t(`acc.group.${g.key}` as Key)}</h2>
                  <span className="num text-sm font-semibold">{money(total)}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((a) => (
                    <Link key={a.id} href={`/accounts/${a.id}`} className="card group flex items-center gap-3 p-4 transition hover:border-brand/50">
                      <IconTile name={a.icon} color={a.color} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{a.name}</p>
                        <p className="truncate text-xs text-muted">{t(`acc.type.${a.type}` as Key)}{a.institution ? ` · ${a.institution}` : ""}{a.status === "archived" ? ` · ${t("acc.archived")}` : ""}</p>
                      </div>
                      <div className="text-right">
                        <p className={`num font-bold ${a.balance < 0 ? "text-neg" : ""}`}>{money(a.balance, a.currency)}</p>
                        {a.currency !== currency && conv.get(a.id) != null && <p className="num text-[11px] text-muted">≈ {money(conv.get(a.id)!)}</p>}
                      </div>
                      <ChevronRight size={16} className="text-muted" />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
          <div className="max-w-xs"><Toggle checked={showArchived} onChange={setShowArchived} label={t("acc.show_archived")} /></div>
        </div>
      )}
    </div>
  );
}
