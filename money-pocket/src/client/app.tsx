"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "./api";
import type { Account, Category, Me, Transaction } from "./types";
import { translate, type Key } from "@/lib/i18n";
import { categoryLabel } from "@/lib/i18n/categories";
import { formatMoney, intlLocale } from "@/lib/money";

export type TxPrefill = Partial<{
  type: string; amount: number | null; currency: string; fromAccountId: string | null; toAccountId: string | null; categoryId: string | null;
  description: string; merchant: string | null; date: string; time: string | null; paymentMethod: string | null; notes: string | null;
  receiptId: string | null; goalId: string | null; holdingId: string | null; units: string | null; tags: string[];
}> & { uncertain?: string[]; duplicates?: { id: string; date: string; amount: number; currency: string; description: string; merchant: string | null }[] };

interface ModalState {
  tx?: { prefill?: TxPrefill; existing?: Transaction; onSaved?: (t: Transaction) => void };
  account?: { prefill?: Partial<Account>; existing?: Account };
  budget?: { prefill?: Record<string, unknown>; existing?: Record<string, unknown> };
  goal?: { prefill?: Record<string, unknown>; existing?: Record<string, unknown> };
  scanner?: { mode: "receipt" | "banknote" };
}

interface Toast { id: number; message: string; action?: { label: string; onClick: () => void }; tone?: "error" | "ok" }

interface AppCtx {
  me: Me | undefined;
  loading: boolean;
  lang: string;
  t: (k: Key, v?: Record<string, string | number>) => string;
  money: (minor: number, currency?: string, opts?: { sign?: boolean; compact?: boolean; code?: boolean }) => string;
  date: (d: string, style?: "short" | "medium" | "long" | "month") => string;
  currency: string;
  accounts: Account[];
  activeAccounts: Account[];
  categories: Category[];
  catLabel: (c: { name: string | null; systemKey: string | null } | undefined | null) => string;
  accountName: (id: string | null | undefined) => string;
  refresh: () => Promise<void>;
  modals: ModalState;
  open: <K extends keyof ModalState>(k: K, v: ModalState[K]) => void;
  close: (k: keyof ModalState) => void;
  toast: (message: string, opts?: { action?: Toast["action"]; tone?: Toast["tone"] }) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  confirm: (message: string) => Promise<boolean>;
  confirmState: { message: string; resolve: (v: boolean) => void } | null;
}

const Ctx = createContext<AppCtx | null>(null);

export function applyTheme(theme: string) {
  try { localStorage.setItem("mp-theme", theme); } catch {}
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function AppProvider({ children, initialLang = "en", initialCurrency = "LAK" }: { children: ReactNode; initialLang?: string; initialCurrency?: string }) {
  const { data: me, isLoading, mutate } = useSWR<Me>("/api/me", fetcher, { revalidateOnFocus: true });
  const { mutate: globalMutate } = useSWRConfig();
  const [modals, setModals] = useState<ModalState>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<AppCtx["confirmState"]>(null);
  const toastId = useRef(0);

  const lang = me?.settings.language ?? initialLang;
  const currency = me?.settings.primaryCurrency ?? initialCurrency;

  useEffect(() => {
    if (!me) return;
    document.documentElement.lang = me.settings.language;
    try { localStorage.setItem("mp-lang", me.settings.language); } catch {}
    applyTheme(me.settings.theme);
    if (me.settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const on = () => applyTheme("system");
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    }
  }, [me]);

  const t = useCallback((k: Key, v?: Record<string, string | number>) => translate(lang, k, v), [lang]);
  const money = useCallback((m: number, c?: string, o?: { sign?: boolean; compact?: boolean; code?: boolean }) => formatMoney(m, c ?? currency, lang, o), [currency, lang]);
  const date = useCallback((d: string, style: "short" | "medium" | "long" | "month" = "medium") => {
    const dt = new Date(d.length === 7 ? d + "-01T00:00:00Z" : d.slice(0, 10) + "T00:00:00Z");
    const o: Intl.DateTimeFormatOptions =
      style === "short" ? { day: "numeric", month: "short" } :
      style === "month" ? { month: "long", year: "numeric" } :
      style === "long" ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } :
      { day: "numeric", month: "short", year: "numeric" };
    return new Intl.DateTimeFormat(intlLocale(lang), { ...o, timeZone: "UTC" }).format(dt);
  }, [lang]);

  const accounts = useMemo(() => me?.accounts ?? [], [me]);
  const categories = useMemo(() => me?.categories ?? [], [me]);
  const catLabel = useCallback((c: { name: string | null; systemKey: string | null } | undefined | null) =>
    c?.name ? categoryLabel({ name: c.name, systemKey: c.systemKey }, lang) : translate(lang, "common.uncategorized"), [lang]);
  const accountName = useCallback((id: string | null | undefined) => accounts.find((a) => a.id === id)?.name ?? "—", [accounts]);

  const refresh = useCallback(async () => {
    await mutate();
    await globalMutate((key) => typeof key === "string" && key.startsWith("/api/") && key !== "/api/me", undefined, { revalidate: true });
  }, [mutate, globalMutate]);

  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const toast = useCallback((message: string, opts?: { action?: Toast["action"]; tone?: Toast["tone"] }) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, message, ...opts }]);
    setTimeout(() => dismissToast(id), opts?.action ? 7000 : 3500);
  }, [dismissToast]);

  const value: AppCtx = {
    me, loading: isLoading, lang, t, money, date, currency, accounts,
    activeAccounts: accounts.filter((a) => a.status === "active"),
    categories, catLabel, accountName, refresh, modals,
    open: (k, v) => setModals((m) => ({ ...m, [k]: v })),
    close: (k) => setModals((m) => ({ ...m, [k]: undefined })),
    toast, toasts, dismissToast,
    confirm: (message) => new Promise<boolean>((resolve) => setConfirmState({ message, resolve: (v) => { setConfirmState(null); resolve(v); } })),
    confirmState,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

/** Error message for an API failure, translated where we have a key. */
export function errorText(t: AppCtx["t"], e: unknown): string {
  const err = e as { code?: string; message?: string; extra?: { message?: string } };
  if (err?.code === "invalid_credentials") return t("auth.invalid");
  if (err?.code === "email_taken") return t("auth.taken");
  if (err?.code === "file_too_large") return t("scan.too_large");
  if (err?.code === "unsupported_image") return t("scan.unsupported");
  return err?.message && err.message !== "error" ? err.message : t("common.error");
}
