"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import clsx from "clsx";
import { Send, Bot, Plus, Trash2, ArrowRight, Sparkles } from "lucide-react";
import { useApp, errorText } from "@/client/app";
import { api, fetcher } from "@/client/api";
import type { ChatReply, UiBlock } from "@/lib/chat-types";
import type { Key } from "@/lib/i18n";
import { CashflowChart, DonutList } from "./charts";
import { Meter, Spinner } from "./ui";

interface Msg { id: string; role: "user" | "assistant"; content: string; ui?: UiBlock[] | null; engine?: string }

export function ChatPanel({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { t, me, toast } = useApp();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<string>(me?.features.ai ? "claude" : "rules");
  const { data: sessions, mutate: reloadSessions } = useSWR<{ id: string; title: string; updatedAt: string }[]>(compact ? null : "/api/chat/sessions", fetcher);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  async function loadSession(id: string) {
    const rows = await api<{ id: string; role: "user" | "assistant"; content: string; ui: UiBlock[] | null }[]>(`/api/chat/sessions/${id}`);
    setSessionId(id);
    setMessages(rows);
  }

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: msg }]);
    setBusy(true);
    try {
      const r = await api<ChatReply>("/api/chat", { body: { message: msg, sessionId } });
      setSessionId(r.sessionId);
      setEngine(r.engine);
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: "assistant", content: r.message, ui: r.ui, engine: r.engine }]);
      reloadSessions();
    } catch (e) {
      toast(errorText(t, e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const suggestions: Key[] = ["chat.s1", "chat.s2", "chat.s3", "chat.s4", "chat.s5", "chat.s6"];

  return (
    <div className={clsx("flex h-full min-h-0 gap-4", !compact && "lg:grid lg:grid-cols-[240px_1fr]")}>
      {!compact && (
        <aside className="card hidden min-h-0 flex-col overflow-hidden lg:flex">
          <div className="flex items-center justify-between border-b border-line p-3">
            <span className="text-sm font-semibold">{t("chat.history")}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSessionId(undefined); setMessages([]); }} aria-label={t("chat.new")}><Plus size={16} /></button>
          </div>
          <ul className="flex-1 overflow-y-auto p-2">
            {(sessions ?? []).map((s) => (
              <li key={s.id} className="group flex items-center">
                <button className={clsx("min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm", s.id === sessionId ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-card-2")} onClick={() => loadSession(s.id)}>{s.title || "…"}</button>
                <button className="btn btn-ghost btn-sm !px-1.5 opacity-0 group-hover:opacity-100" aria-label={t("common.delete")} onClick={async () => { await api(`/api/chat/sessions/${s.id}`, { method: "DELETE" }); if (s.id === sessionId) { setSessionId(undefined); setMessages([]); } reloadSessions(); }}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </aside>
      )}
      <section className={clsx("flex min-h-0 flex-1 flex-col", !compact && "card overflow-hidden")}>
        <div className={clsx("flex items-center justify-between gap-2", !compact && "border-b border-line px-4 py-3")}>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Sparkles size={14} className="text-brand" />{engine === "claude" ? t("chat.engine.claude") : t("chat.engine.rules")}</span>
          {!compact ? <button className="btn btn-soft btn-sm lg:hidden" onClick={() => { setSessionId(undefined); setMessages([]); }}><Plus size={14} />{t("chat.new")}</button> : messages.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { setSessionId(undefined); setMessages([]); }}><Plus size={14} />{t("chat.new")}</button>}
        </div>
        <div className={clsx("flex-1 space-y-4 overflow-y-auto", compact ? "py-3" : "p-4")}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Bot size={28} /></div>
              <p className="max-w-md text-sm text-ink-2">{t("chat.help")}</p>
              <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("chat.suggested")}</p>
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {suggestions.map((k) => <button key={k} className="chip !py-1.5 !text-[13px] hover:border-brand" onClick={() => send(t(k))}>{t(k)}</button>)}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={clsx("max-w-[92%] space-y-3", m.role === "user" && "max-w-[80%]")}>
                {m.content && (
                  <div className={clsx("whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm", m.role === "user" ? "rounded-br-md bg-brand text-brand-ink" : "rounded-bl-md bg-card-2 text-ink")}>{m.content}</div>
                )}
                {m.ui?.map((b, i) => <Block key={i} block={b} onNavigate={onNavigate} />)}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> …</div>}
          <div ref={endRef} />
        </div>
        <form className={clsx("flex gap-2", compact ? "pt-2" : "border-t border-line p-3")} onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("chat.placeholder")} maxLength={2000} aria-label={t("chat.placeholder")} />
          <button className="btn btn-primary" disabled={busy || !input.trim()} aria-label={t("chat.send")}><Send size={16} /></button>
        </form>
      </section>
    </div>
  );
}

function Block({ block, onNavigate }: { block: UiBlock; onNavigate?: () => void }) {
  const { t, money, date, open, catLabel, categories } = useApp();
  const router = useRouter();
  const box = "rounded-2xl border border-line bg-card p-4";
  switch (block.type) {
    case "summary":
      return (
        <div className={box}>
          <p className="mb-2 text-xs text-muted">{block.label}</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label={t("dash.income")} value={money(block.income, block.currency)} dot="var(--income)" />
            <Stat label={t("dash.expenses")} value={money(block.expense, block.currency)} dot="var(--expense)" />
            <Stat label={t("dash.net")} value={money(block.net, block.currency, { sign: true })} />
          </div>
          {block.topCategories.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              {block.topCategories.slice(0, 3).map((c) => (
                <li key={c.id} className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ background: c.color }} /><span className="flex-1 text-ink-2">{catLabel(c)}</span><span className="num font-medium">{money(c.amount, block.currency)}</span></li>
              ))}
            </ul>
          )}
        </div>
      );
    case "categories":
      return <div className={box}><DonutList items={block.items.map((c) => ({ id: c.id, label: catLabel(c), color: c.color, amount: c.amount }))} total={block.items.reduce((s, c) => s + c.amount, 0)} emptyText={t("chat.r.no_expenses")} /></div>;
    case "cashflow":
      return block.series.some((s) => s.income || s.expense) ? <div className={box}><CashflowChart data={block.series} height={180} /></div> : null;
    case "comparison":
      return (
        <div className={clsx(box, "grid grid-cols-2 gap-3 text-sm")}>
          {[block.current, block.previous].map((p, i) => (
            <div key={i}>
              <p className="text-xs text-muted">{p.label}</p>
              <p className="num mt-1 font-semibold">{money(p.expense, block.currency)}</p>
              <p className="num text-xs text-muted">{t("dash.income")}: {money(p.income, block.currency)}</p>
            </div>
          ))}
          {block.change.expense !== null && <p className="col-span-2 text-xs text-ink-2">{t("dash.expenses")}: {block.change.expense >= 0 ? "▲" : "▼"} {Math.abs(block.change.expense)}%</p>}
        </div>
      );
    case "transactions":
      return (
        <div className={box}>
          {block.items.length === 0 ? <p className="text-sm text-muted">{t("tx.empty")}</p> : (
            <ul className="divide-y divide-line text-sm">
              {block.items.map((x) => (
                <li key={x.id} className="flex items-center gap-2 py-2">
                  <span className="w-16 shrink-0 text-xs text-muted">{date(x.date, "short")}</span>
                  <span className="min-w-0 flex-1 truncate">{x.description || x.merchant || t(`tx.type.${x.type}` as Key)}</span>
                  <span className="num font-semibold">{money(x.amount, x.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          {(block.total ?? 0) > block.items.length && <button className="mt-2 text-xs font-semibold text-brand" onClick={() => { router.push("/transactions"); onNavigate?.(); }}>{t("common.view_all")} ({block.total})</button>}
        </div>
      );
    case "accounts":
      return (
        <div className={box}>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Stat label={t("dash.net_worth")} value={money(block.netWorth, block.currency)} />
            <Stat label={t("dash.available_cash")} value={money(block.availableCash, block.currency)} />
          </div>
          <ul className="divide-y divide-line text-sm">
            {block.accounts.map((a) => <li key={a.id} className="flex justify-between py-1.5"><span className="text-ink-2">{a.name}</span><span className="num font-medium">{money(a.balance, a.currency)}</span></li>)}
          </ul>
        </div>
      );
    case "budgets":
      return (
        <div className={clsx(box, "space-y-3")}>
          {block.items.map((b) => {
            const c = categories.find((x) => x.id === b.categoryId);
            const r = b.available > 0 ? b.spent / b.available : 1;
            return (
              <div key={b.id}>
                <div className="mb-1 flex justify-between text-sm"><span>{c ? catLabel(c) : t("budgets.overall")} · <span className="text-muted">{t(`period.${b.period}` as Key)}</span></span><span className="num text-xs text-muted">{money(b.spent, block.currency)} / {money(b.available, block.currency)}</span></div>
                <Meter value={r} color={r >= 1 ? "var(--bad)" : r >= 0.8 ? "var(--warn)" : "var(--good)"} />
              </div>
            );
          })}
        </div>
      );
    case "goals":
      return (
        <div className={clsx(box, "space-y-3")}>
          {block.items.map((g) => (
            <div key={g.id}>
              <div className="mb-1 flex justify-between text-sm"><span>{g.name}</span><span className="num text-xs text-muted">{money(g.current, g.currency)} / {money(g.target, g.currency)}</span></div>
              <Meter value={g.progress} color="var(--savings)" />
            </div>
          ))}
        </div>
      );
    case "action": {
      const label = t(`chat.action.${block.action}` as Key);
      const run = () => {
        if (block.action === "add_transaction") open("tx", { prefill: block.prefill as never });
        else if (block.action === "create_account") open("account", { prefill: block.prefill as never });
        else if (block.action === "create_budget") open("budget", { prefill: block.prefill });
        else if (block.action === "create_goal") open("goal", {});
        else if (block.action === "scan") open("scanner", { mode: (block.prefill?.mode as "receipt" | "banknote") ?? "receipt" });
        else if (block.href) { router.push(block.href); onNavigate?.(); }
      };
      const p = block.prefill ?? {};
      return (
        <div className="flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand-soft p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{label}</p>
            {block.action === "add_transaction" && typeof p.amount === "number" && <p className="num text-xs text-ink-2">{t(`tx.type.${p.type}` as Key)} · {money(p.amount, p.currency as string)}{p.description ? ` · ${p.description}` : ""}</p>}
            {block.action === "create_account" && <p className="text-xs text-ink-2">{String(p.name ?? "")}</p>}
            {block.action !== "navigate" && block.action !== "scan" && <p className="text-[11px] text-muted">{t("chat.not_saved")}</p>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={run}>{block.action === "navigate" ? t("chat.open_view") : block.action === "scan" ? t("chat.open_scanner") : t("chat.open_form")} <ArrowRight size={14} /></button>
        </div>
      );
    }
  }
}

function Stat({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-card-2 px-2 py-2">
      <p className="flex items-center justify-center gap-1 text-[11px] text-muted">{dot && <span className="h-2 w-2 rounded-sm" style={{ background: dot }} />}{label}</p>
      <p className="num truncate text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
