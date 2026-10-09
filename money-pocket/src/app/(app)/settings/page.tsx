"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Trash2, Plus, ExternalLink, RefreshCw, Send, FileSpreadsheet, Download, ShieldCheck, BellRing } from "lucide-react";
import { useApp, errorText, applyTheme } from "@/client/app";
import { api, fetcher } from "@/client/api";
import type { Settings } from "@/client/types";
import { Badge, Card, Field, Loading, Modal, PageHeader, SectionTitle, StatusDot, Toggle } from "@/components/ui";
import { LANGUAGES, type Lang } from "@/lib/domain";
import { CURRENCY_CODES } from "@/lib/money";
import { LANGUAGE_NAMES, type Key } from "@/lib/i18n";
import { todayIn } from "@/lib/dates";

interface Status { ai: boolean; push: boolean; email: boolean; sheets: boolean; cron: boolean; internalScheduler: boolean; database: string; scheduler: { at: string; sent: number } | null }
interface Rate { id: string; base: string; quote: string; rate: string; effectiveDate: string }
interface Sheets { configured: boolean; connected: boolean; spreadsheetUrl: string | null; autoSync: boolean; dirty: boolean; lastSyncAt: string | null; lastError: string | null; jobs: { id: string; status: string; trigger: string; rowsWritten: number; error: string | null; startedAt: string }[] }

const TIMEZONES = ["Asia/Vientiane", "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC"];

export default function SettingsPage() {
  return <Suspense fallback={<Loading />}><SettingsInner /></Suspense>;
}

function SettingsInner() {
  const { t, me, refresh, toast } = useApp();
  const { data: status } = useSWR<Status>("/api/status", fetcher);
  if (!me) return <Loading />;
  const s = me.settings;
  async function save(patch: Partial<Settings>) {
    try {
      await api("/api/settings", { method: "PATCH", body: patch });
      if (patch.theme) applyTheme(patch.theme);
      await refresh();
      toast(t("set.saved"), { tone: "ok" });
    } catch (e) {
      toast(errorText(t, e), { tone: "error" });
    }
  }
  const tzs = TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES];
  return (
    <div className="space-y-5">
      <PageHeader title={t("set.title")} />
      <Card className="p-5">
        <SectionTitle title={t("set.preferences")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("set.language")}>
            <select className="input" value={s.language} onChange={(e) => save({ language: e.target.value as Lang })}>{LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}</select>
          </Field>
          <Field label={t("set.primary_currency")} hint={t("set.primary_currency_hint")}>
            <select className="input" value={s.primaryCurrency} onChange={(e) => save({ primaryCurrency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label={t("set.theme")}>
            <select className="input" value={s.theme} onChange={(e) => save({ theme: e.target.value })}>{["system", "light", "dark"].map((x) => <option key={x} value={x}>{t(`set.theme.${x}` as Key)}</option>)}</select>
          </Field>
          <Field label={t("set.timezone")}>
            <select className="input" value={s.timezone} onChange={(e) => save({ timezone: e.target.value })}>{tzs.map((z) => <option key={z}>{z}</option>)}</select>
          </Field>
        </div>
      </Card>
      <Rates />
      <Notifications settings={s} save={save} status={status} />
      <SheetsCard status={status} />
      <StatusCard status={status} />
      <DataCard />
    </div>
  );
}

function Rates() {
  const { t, me, refresh } = useApp();
  const { data, mutate } = useSWR<Rate[]>("/api/rates", fetcher);
  const [base, setBase] = useState("USD");
  const [quote, setQuote] = useState(me?.settings.primaryCurrency ?? "LAK");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(todayIn(me?.settings.timezone ?? "Asia/Vientiane"));
  const [error, setError] = useState<string | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/rates", { body: { base, quote, rate: rate.replace(/,/g, ""), effectiveDate: date } });
      setRate("");
      mutate();
      refresh();
    } catch (err) {
      setError(errorText(t, err));
    }
  }
  return (
    <Card className="p-5">
      <SectionTitle title={t("set.rates")} hint={t("set.rates_hint", { base: base, quote: quote })} />
      <form onSubmit={add} className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_auto_1fr_auto_auto] sm:items-end">
        <Field label="1 ×"><select className="input" value={base} onChange={(e) => setBase(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="="><select className="input" value={quote} onChange={(e) => setQuote(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label={t("set.rate")}><input className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required placeholder="21500" /></Field>
        <Field label={t("set.effective")}><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <button className="btn btn-primary"><Plus size={16} />{t("set.add_rate")}</button>
      </form>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      {!data?.length ? <p className="mt-4 text-sm text-muted">{t("set.no_rates")}</p> : (
        <ul className="mt-4 divide-y divide-line text-sm">
          {data.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span className="num">1 {r.base} = <b>{Number(r.rate).toLocaleString(undefined, { maximumFractionDigits: 8 })}</b> {r.quote}</span>
              <span className="flex items-center gap-2 text-xs text-muted">{t("set.effective")} {r.effectiveDate}
                <button className="btn btn-ghost btn-sm !px-2" aria-label={t("common.delete")} onClick={async () => { await api(`/api/rates/${r.id}`, { method: "DELETE" }); mutate(); refresh(); }}><Trash2 size={14} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function b64ToUint8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function Notifications({ settings: s, save, status }: { settings: Settings; save: (p: Partial<Settings>) => void; status?: Status }) {
  const { t, toast, lang } = useApp();
  const [perm, setPerm] = useState<string>("default");
  const [subscribed, setSubscribed] = useState(false);
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  useEffect(() => {
    if (!supported) return;
    setPerm(Notification.permission);
    navigator.serviceWorker.getRegistration("/sw.js").then((r) => r?.pushManager.getSubscription()).then((sub) => setSubscribed(!!sub)).catch(() => {});
  }, [supported]);
  async function enablePush() {
    try {
      const { publicKey } = await api<{ publicKey: string | null }>("/api/push");
      if (!publicKey) return toast(t("set.push_not_configured"), { tone: "error" });
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") return;
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) });
      await api("/api/push", { body: sub.toJSON() });
      setSubscribed(true);
      if (!s.channelPush) save({ channelPush: true });
      toast(t("set.push_enabled"), { tone: "ok" });
    } catch (e) {
      toast(errorText(t, e), { tone: "error" });
    }
  }
  async function test() {
    const r = await api<{ pushStatus: string | null }>("/api/notifications/test", { body: {} });
    toast(`${t("notif.test.title")} · push: ${r.pushStatus ?? "off"}`, { tone: "ok" });
  }
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  return (
    <Card className="p-5" id="notifications">
      <SectionTitle title={t("set.notifications")} />
      <div className="max-w-xs"><Field label={t("set.reminder_time")}><input type="time" className="input" value={s.reminderTime} onChange={(e) => e.target.value && save({ reminderTime: e.target.value })} /></Field></div>
      <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
        <Toggle checked={s.notifyDaily} onChange={(v) => save({ notifyDaily: v })} label={t("set.notify.daily")} />
        <Toggle checked={s.notifyWeekly} onChange={(v) => save({ notifyWeekly: v })} label={t("set.notify.weekly")} />
        <Toggle checked={s.notifyMonthly} onChange={(v) => save({ notifyMonthly: v })} label={t("set.notify.monthly")} />
        <Toggle checked={s.notifyBudget} onChange={(v) => save({ notifyBudget: v })} label={t("set.notify.budget")} />
        <Toggle checked={s.notifyBills} onChange={(v) => save({ notifyBills: v })} label={t("set.notify.bills")} />
        <Toggle checked={s.notifyUncategorized} onChange={(v) => save({ notifyUncategorized: v })} label={t("set.notify.uncategorized")} />
      </div>
      <h3 className="mt-5 mb-1 text-sm font-semibold">{t("set.channels")}</h3>
      <p className="py-2 text-sm">✓ {t("set.channel.inapp")}</p>
      <Toggle checked={s.channelPush && !!status?.push} onChange={(v) => save({ channelPush: v })} label={t("set.channel.push")} disabled={!status?.push}
        hint={!status?.push ? t("set.push_not_configured") : !supported ? t("set.push_unsupported") : perm === "denied" ? t("set.push_denied") : subscribed ? t("set.push_enabled") : t("set.push_permission")} />
      {status?.push && supported && !subscribed && perm !== "denied" && <button className="btn btn-soft btn-sm mb-2" onClick={enablePush}><BellRing size={15} />{t("set.push_enable")}</button>}
      <Toggle checked={s.channelEmail && !!status?.email} onChange={(v) => save({ channelEmail: v })} label={t("set.channel.email")} disabled={!status?.email} hint={!status?.email ? t("set.email_not_configured") : undefined} />
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button className="btn btn-soft btn-sm" onClick={test}><Send size={15} />{t("set.send_test")}</button>
        <span className="text-xs text-muted">{t("set.scheduler")}: {status?.scheduler ? t("set.scheduler_last", { time: fmt.format(new Date(status.scheduler.at)) }) : t("set.scheduler_never")}</span>
      </div>
    </Card>
  );
}

function SheetsCard({ status }: { status?: Status }) {
  const { t, lang, toast } = useApp();
  const sp = useSearchParams();
  const router = useRouter();
  const { data, mutate } = useSWR<Sheets>("/api/integrations/google", fetcher);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const r = sp.get("sheets");
    if (r) {
      toast(r === "connected" ? t("set.sheets_connected") : `Google Sheets: ${r}`, { tone: r === "connected" ? "ok" : "error" });
      router.replace("/settings");
    }
  }, [sp, router, toast, t]);
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  async function sync() {
    setBusy(true);
    try {
      const j = await api<{ status: string; error: string | null }>("/api/integrations/google/sync", { body: {} });
      toast(j.status === "success" ? t("common.saved") : j.error ?? t("common.error"), { tone: j.status === "success" ? "ok" : "error" });
      mutate();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-5">
      <SectionTitle title={<span className="flex items-center gap-2"><FileSpreadsheet size={18} className="text-good" />{t("set.sheets")} {data?.connected && <Badge tone="good">{t("set.sheets_connected")}</Badge>}</span>} hint={t("set.sheets_hint")} />
      {!data ? <Loading /> : !data.configured || !status?.sheets ? (
        <p className="rounded-xl bg-card-2 p-3 text-sm text-ink-2">{t("set.sheets_not_configured")}</p>
      ) : !data.connected ? (
        <a className="btn btn-primary" href="/api/integrations/google/start">{t("set.sheets_connect")}</a>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {data.spreadsheetUrl && <a className="btn btn-soft btn-sm" href={data.spreadsheetUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />{t("set.sheets_open")}</a>}
            <button className="btn btn-primary btn-sm" onClick={sync} disabled={busy}><RefreshCw size={15} className={busy ? "animate-spin" : ""} />{t("set.sheets_sync")}</button>
            <button className="btn btn-danger btn-sm" onClick={async () => { await api("/api/integrations/google", { method: "DELETE" }); mutate(); }}>{t("set.sheets_disconnect")}</button>
          </div>
          <p className="text-xs text-muted">{data.lastSyncAt ? t("set.sheets_last", { time: fmt.format(new Date(data.lastSyncAt)) }) : t("common.never")}{data.dirty ? ` · ${t("set.sheets_pending")}` : ""}</p>
          {data.lastError && <p className="text-xs text-bad">{data.lastError}</p>}
          <Toggle checked={data.autoSync} onChange={async (v) => { await api("/api/integrations/google", { method: "PATCH", body: { autoSync: v } }); mutate(); }} label={t("set.sheets_auto")} />
          {data.jobs.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">{t("set.sheets_history")}</summary>
              <ul className="mt-2 space-y-1">{data.jobs.map((j) => <li key={j.id} className="flex gap-2"><StatusDot ok={j.status === "success"} />{fmt.format(new Date(j.startedAt))} · {j.trigger} · {j.status}{j.status === "success" ? ` · ${j.rowsWritten} rows` : j.error ? ` · ${j.error}` : ""}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

function StatusCard({ status }: { status?: Status }) {
  const { t } = useApp();
  if (!status) return null;
  const rows: [string, boolean, string?][] = [
    [t("set.ai"), status.ai, status.ai ? "Claude" : "ANTHROPIC_API_KEY"],
    [t("set.channel.push"), status.push, status.push ? "Web Push (VAPID)" : "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY"],
    [t("set.channel.email"), status.email, status.email ? "Resend" : "RESEND_API_KEY / EMAIL_FROM"],
    [t("set.sheets"), status.sheets, status.sheets ? "OAuth (drive.file)" : "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"],
    [t("set.scheduler"), status.cron, status.internalScheduler ? "INTERNAL_SCHEDULER" : status.cron ? "CRON_SECRET → /api/cron/tick" : "CRON_SECRET"],
    ["Database", true, status.database === "postgres" ? "PostgreSQL" : "Embedded Postgres (PGlite)"],
  ];
  return (
    <Card className="p-5">
      <SectionTitle title={t("set.integrations")} />
      <ul className="divide-y divide-line text-sm">
        {rows.map(([l, ok, d]) => (
          <li key={l} className="flex items-center gap-3 py-2.5">
            <StatusDot ok={ok} />
            <span className="flex-1">{l}</span>
            <span className="text-xs text-muted">{ok ? t("common.configured") : t("common.not_configured")} · <code>{d}</code></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DataCard() {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  async function del() {
    await api("/api/me", { method: "DELETE", body: { confirm } });
    location.href = "/login";
  }
  return (
    <Card className="p-5">
      <SectionTitle title={t("set.data")} />
      <p className="mb-4 flex items-center gap-2 text-sm text-ink-2"><ShieldCheck size={16} className="text-brand" />{t("set.privacy_note")}</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-soft" href="/api/export/json"><Download size={16} />{t("set.export")}</a>
        <button className="btn btn-danger" onClick={() => setOpen(true)}><Trash2 size={16} />{t("set.delete_account")}</button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t("set.delete_account")}
        footer={<><button className="btn btn-soft" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="btn btn-danger" disabled={confirm !== "DELETE"} onClick={del}>{t("common.delete")}</button></>}>
        <p className="mb-3 text-sm text-ink-2">{t("set.delete_confirm")}</p>
        <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
      </Modal>
    </Card>
  );
}
