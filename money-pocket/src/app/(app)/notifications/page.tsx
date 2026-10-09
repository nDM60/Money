"use client";
import Link from "next/link";
import useSWR from "swr";
import clsx from "clsx";
import { Bell, CheckCheck, Settings } from "lucide-react";
import { useApp } from "@/client/app";
import { api, fetcher } from "@/client/api";
import { Card, Empty, Loading, PageHeader } from "@/components/ui";

interface N { id: string; kind: string; title: string; body: string; data: { url?: string } | null; readAt: string | null; createdAt: string; pushStatus: string | null }

export default function NotificationsPage() {
  const { t, lang, refresh } = useApp();
  const { data, mutate } = useSWR<N[]>("/api/notifications", fetcher);
  async function read(id?: string) {
    await api("/api/notifications", { body: id ? { id } : {} });
    mutate();
    refresh();
  }
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div>
      <PageHeader title={t("notif.title")} actions={<>
        <Link href="/settings#notifications" className="btn btn-soft"><Settings size={16} />{t("set.notifications")}</Link>
        <button className="btn btn-soft" onClick={() => read()}><CheckCheck size={16} />{t("notif.mark_all")}</button>
      </>} />
      <Card className="p-2">
        {!data ? <Loading /> : data.length === 0 ? <Empty icon={<Bell size={36} />} title={t("notif.empty")} /> : (
          <ul className="divide-y divide-line">
            {data.map((n) => (
              <li key={n.id} className={clsx("flex gap-3 p-3", !n.readAt && "bg-brand-soft/50")}>
                <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{n.title}</p>
                  <p className="text-sm text-ink-2">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted">{fmt.format(new Date(n.createdAt))}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {n.data?.url && <Link href={n.data.url} onClick={() => !n.readAt && read(n.id)} className="btn btn-soft btn-sm">{t("chat.open_view")}</Link>}
                  {!n.readAt && <button className="text-[11px] text-muted hover:text-ink" onClick={() => read(n.id)}>✓</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
