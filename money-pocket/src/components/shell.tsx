"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, ArrowLeftRight, Wallet, Target, PiggyBank, TrendingUp, BarChart3, Bot, Bell, Settings, Repeat, Plus, ScanLine,
  MoreHorizontal, LogOut, ArrowDownRight, ArrowUpRight, MessageSquare, X, Info,
} from "lucide-react";
import { useApp } from "@/client/app";
import { api } from "@/client/api";
import type { Key } from "@/lib/i18n";
import { Modal } from "./ui";
import { GlobalModals } from "./global-modals";
import { ChatPanel } from "./chat";

const NAV: { href: string; key: Key; icon: typeof LayoutDashboard }[] = [
  { href: "/", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/transactions", key: "nav.transactions", icon: ArrowLeftRight },
  { href: "/accounts", key: "nav.accounts", icon: Wallet },
  { href: "/budgets", key: "nav.budgets", icon: Target },
  { href: "/savings", key: "nav.savings", icon: PiggyBank },
  { href: "/investments", key: "nav.investments", icon: TrendingUp },
  { href: "/reports", key: "nav.reports", icon: BarChart3 },
  { href: "/recurring", key: "nav.recurring", icon: Repeat },
  { href: "/assistant", key: "nav.assistant", icon: Bot },
  { href: "/notifications", key: "nav.notifications", icon: Bell },
  { href: "/settings", key: "nav.settings", icon: Settings },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, me, open, toasts, dismissToast, confirmState } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const [chat, setChat] = useState(false);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} });
    router.replace("/login");
  }

  const quickActions = [
    { label: t("tx.new_expense"), icon: ArrowUpRight, color: "var(--expense)", run: () => open("tx", { prefill: { type: "expense" } }) },
    { label: t("tx.new_income"), icon: ArrowDownRight, color: "var(--income)", run: () => open("tx", { prefill: { type: "income" } }) },
    { label: t("tx.new_transfer"), icon: ArrowLeftRight, color: "var(--savings)", run: () => open("tx", { prefill: { type: "transfer" } }) },
    { label: t("nav.scan"), icon: ScanLine, color: "var(--invest)", run: () => open("scanner", { mode: "receipt" }) },
  ];

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-card lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
          <img src="/icon-192.png" alt="" className="h-9 w-9 rounded-xl" />
          <div>
            <div className="text-[15px] font-bold tracking-tight text-ink">{t("app.name")}</div>
            <div className="text-[11px] text-muted">{t("app.tagline")}</div>
          </div>
        </Link>
        <div className="px-4 pb-3">
          <button className="btn btn-primary w-full" onClick={() => setQuick(true)}>
            <Plus size={18} /> {t("dash.quick_add")}
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-card-2 hover:text-ink")}>
                <n.icon size={18} />
                <span className="flex-1 truncate">{t(n.key)}</span>
                {n.href === "/notifications" && !!me?.unread && <span className="rounded-full bg-expense px-1.5 text-[10px] font-bold text-white">{me.unread}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">{(me?.user.name || me?.user.email || "?").slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{me?.user.name || "—"}</div>
              <div className="truncate text-[11px] text-muted">{me?.user.isDemo ? "Demo" : me?.user.email}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={logout} aria-label={t("nav.logout")} title={t("nav.logout")}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-line bg-card/85 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <Link href="/" className="flex items-center gap-2">
          <img src="/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-bold tracking-tight">{t("app.name")}</span>
        </Link>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-sm" onClick={() => open("scanner", { mode: "receipt" })} aria-label={t("nav.scan")}><ScanLine size={20} /></button>
          <Link href="/notifications" className="btn btn-ghost btn-sm relative" aria-label={t("nav.notifications")}>
            <Bell size={20} />
            {!!me?.unread && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-expense" />}
          </Link>
        </div>
      </header>

      {me?.user.isDemo && (
        <div className="no-print flex items-center gap-2 border-b border-line bg-brand-soft px-4 py-2 text-xs font-medium text-brand">
          <Info size={14} /> {t("common.demo_banner")}
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-5 sm:px-6 lg:pb-12 lg:pt-8">{children}</main>

      {/* Mobile bottom navigation */}
      <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
          {NAV.slice(0, 2).map((n) => <BottomItem key={n.href} href={n.href} label={t(n.key)} icon={n.icon} active={isActive(path, n.href)} />)}
          <div className="flex justify-center">
            <button onClick={() => setQuick(true)} className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-brand-ink shadow-lg shadow-brand/30" aria-label={t("dash.quick_add")}>
              <Plus size={26} />
            </button>
          </div>
          <BottomItem href="/accounts" label={t("nav.accounts")} icon={Wallet} active={isActive(path, "/accounts")} />
          <button onClick={() => setMore(true)} className={clsx("flex flex-col items-center gap-0.5 py-1.5 text-[10.5px] font-medium", more ? "text-brand" : "text-muted")}>
            <MoreHorizontal size={22} /> {t("nav.more")}
          </button>
        </div>
      </nav>

      {/* Floating assistant */}
      {!path.startsWith("/assistant") && (
        <button onClick={() => setChat(true)} className="no-print fixed bottom-24 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--hero-1)] text-white shadow-xl ring-1 ring-white/10 transition-transform hover:scale-105 lg:bottom-6 lg:right-6 lg:h-14 lg:w-14" aria-label={t("nav.assistant")}>
          <MessageSquare size={22} />
        </button>
      )}

      <Modal open={more} onClose={() => setMore(false)} title={t("nav.more")}>
        <div className="grid grid-cols-3 gap-2 pb-2">
          {NAV.slice(3).map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-card-2 p-3 text-center text-xs font-medium text-ink">
              <n.icon size={22} className="text-brand" /> {t(n.key)}
            </Link>
          ))}
          <button onClick={logout} className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-card-2 p-3 text-xs font-medium text-ink"><LogOut size={22} className="text-muted" />{t("nav.logout")}</button>
        </div>
      </Modal>

      <Modal open={quick} onClose={() => setQuick(false)} title={t("dash.quick_add")}>
        <div className="grid grid-cols-2 gap-3 pb-2">
          {quickActions.map((a) => (
            <button key={a.label} onClick={() => { setQuick(false); a.run(); }} className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 p-4 text-left text-sm font-semibold text-ink hover:border-brand">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${a.color} 15%, transparent)`, color: a.color }}><a.icon size={20} /></span>
              {a.label}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={chat} onClose={() => setChat(false)} title={t("chat.title")} wide>
        <div className="h-[70dvh]"><ChatPanel compact onNavigate={() => setChat(false)} /></div>
      </Modal>

      <GlobalModals />

      {confirmState && (
        <Modal open onClose={() => confirmState.resolve(false)} title={t("common.are_you_sure")}
          footer={<><button className="btn btn-soft" onClick={() => confirmState.resolve(false)}>{t("common.cancel")}</button><button className="btn btn-primary" onClick={() => confirmState.resolve(true)}>{t("common.confirm")}</button></>}>
          <p className="text-sm text-ink-2">{confirmState.message}</p>
        </Modal>
      )}

      <div className="no-print pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={clsx("pointer-events-auto fade-in flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium shadow-xl", x.tone === "error" ? "bg-bad text-white" : "bg-[#111827] text-white")}>
            <span className="flex-1">{x.message}</span>
            {x.action && <button className="font-bold text-[#5eead4]" onClick={() => { x.action!.onClick(); dismissToast(x.id); }}>{x.action.label}</button>}
            <button onClick={() => dismissToast(x.id)} aria-label={t("common.close")} className="opacity-60"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BottomItem({ href, label, icon: I, active }: { href: string; label: string; icon: typeof LayoutDashboard; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={clsx("flex flex-col items-center gap-0.5 py-1.5 text-[10.5px] font-medium", active ? "text-brand" : "text-muted")}>
      <I size={22} />
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}
