import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq } from "drizzle-orm";
import { schema } from "../db";
import type { ChatReply, UiBlock } from "@/lib/chat-types";
import type { Lang } from "@/lib/domain";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { categoryLabel } from "@/lib/i18n/categories";
import { notFound } from "../http";
import { aiConfigured, anthropic, AI_MODEL, FALLBACK_BETA } from "../ai";
import type { Exec } from "./common";
import { getSettings, userToday } from "./settings";
import { runTool, TOOL_DEFS, type ToolContext } from "./chat-tools";
import { parseIntent } from "./chat-rules";

const LANG_NAME: Record<string, string> = { en: "English", lo: "Lao", th: "Thai", vi: "Vietnamese" };

function systemPrompt(ctx: ToolContext) {
  return `You are Money Pocket's financial assistant, inside a personal finance app.
Today is ${ctx.today} (user's time zone ${ctx.settings.timezone}). The user's primary currency is ${ctx.settings.primaryCurrency}.
Reply in ${LANG_NAME[ctx.settings.language] ?? "English"} unless the user writes in another language, in which case use theirs.

Ground rules:
- Every number you state must come from a tool result in this conversation. Never estimate, invent or reuse example figures. If the data is missing, say so.
- Opening balances are existing money, not income. Transfers between the user's own accounts are neither income nor expenses.
- You cannot save, edit, delete or transfer anything yourself. For any change, call the matching prepare_* tool (or open_scanner / show_view); it opens a prefilled form that the user reviews and confirms. Say that the form is ready for review — never claim something was saved.
- If a request to change data is ambiguous (unclear amount, account or intent), ask a short clarifying question instead of preparing a form.
- Requests to delete records or move money need the user to act in the app; offer to open the relevant screen.
- The app already shows tool results as cards and charts next to your message, so keep the text short: the key figures and one useful observation.
- Only answer questions about the user's finances and this app.`;
}

async function ensureSession(db: Exec, userId: string, sessionId: string | undefined, firstMessage: string) {
  if (sessionId) {
    const [s] = await db.select().from(schema.chatSessions).where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.userId, userId)));
    if (!s) throw notFound();
    return s.id;
  }
  const [s] = await db.insert(schema.chatSessions).values({ userId, title: firstMessage.slice(0, 60) }).returning();
  return s.id;
}

export async function listSessions(db: Exec, userId: string) {
  return db.select().from(schema.chatSessions).where(eq(schema.chatSessions.userId, userId)).orderBy(desc(schema.chatSessions.updatedAt)).limit(30);
}

export async function sessionMessages(db: Exec, userId: string, sessionId: string) {
  const [s] = await db.select().from(schema.chatSessions).where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.userId, userId)));
  if (!s) throw notFound();
  return db.select().from(schema.chatMessages).where(and(eq(schema.chatMessages.sessionId, sessionId), eq(schema.chatMessages.userId, userId))).orderBy(asc(schema.chatMessages.createdAt));
}

export async function deleteSession(db: Exec, userId: string, sessionId: string) {
  await db.delete(schema.chatSessions).where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.userId, userId)));
}

export async function chat(db: Exec, userId: string, text: string, sessionId?: string, opts: { forceRules?: boolean } = {}): Promise<ChatReply> {
  const settings = await getSettings(userId, db);
  const ctx: ToolContext = { db, userId, settings, today: await userToday(userId, db) };
  const sid = await ensureSession(db, userId, sessionId, text);
  const history = sessionId
    ? (await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.sessionId, sid)).orderBy(desc(schema.chatMessages.createdAt)).limit(20)).reverse()
    : [];
  await db.insert(schema.chatMessages).values({ sessionId: sid, userId, role: "user", content: text });

  let reply: { message: string; ui: UiBlock[]; engine: "claude" | "rules" };
  if (aiConfigured() && !opts.forceRules) {
    try {
      reply = { ...(await claudeReply(ctx, history, text)), engine: "claude" };
    } catch (e) {
      console.error("assistant LLM failed, using built-in engine", e);
      reply = { ...(await rulesReply(ctx, text)), engine: "rules" };
    }
  } else {
    reply = { ...(await rulesReply(ctx, text)), engine: "rules" };
  }
  await db.insert(schema.chatMessages).values({ sessionId: sid, userId, role: "assistant", content: reply.message, ui: reply.ui });
  await db.update(schema.chatSessions).set({ updatedAt: new Date() }).where(eq(schema.chatSessions.id, sid));
  return { sessionId: sid, ...reply };
}

async function claudeReply(ctx: ToolContext, history: (typeof schema.chatMessages.$inferSelect)[], text: string) {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const h of history) {
    const role = h.role === "assistant" ? "assistant" : "user";
    // Keep roles alternating; merge consecutive same-role turns.
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === "string") last.content += "\n" + h.content;
    else messages.push({ role, content: h.content || "…" });
  }
  if (messages[0]?.role === "assistant") messages.shift();
  const last = messages[messages.length - 1];
  if (last?.role === "user" && typeof last.content === "string") last.content += "\n" + text;
  else messages.push({ role: "user", content: text });

  const ui: UiBlock[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await anthropic().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: systemPrompt(ctx),
      tools: TOOL_DEFS as unknown as Anthropic.Beta.BetaToolUnion[],
      messages,
    });
    if (res.stop_reason === "refusal") return { message: translate(ctx.settings.language as Lang, "chat.refused"), ui };
    messages.push({ role: "assistant", content: res.content });
    const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      const textOut = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { message: textOut, ui };
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        const r = await runTool(ctx, tu.name, (tu.input ?? {}) as Record<string, unknown>);
        ui.push(...r.ui);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(r.data) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: e instanceof Error ? e.message : "Tool failed", is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { message: translate(ctx.settings.language as Lang, "chat.too_many_steps"), ui };
}

/** Deterministic multilingual engine, used when no LLM is configured. */
export async function rulesReply(ctx: ToolContext, text: string): Promise<{ message: string; ui: UiBlock[] }> {
  const lang = ctx.settings.language as Lang;
  const t = (k: string, v?: Record<string, string | number>) => translate(lang, k as never, v);
  const cur = ctx.settings.primaryCurrency;
  const fmt = (n: number) => formatMoney(n, cur, lang);
  const intent = parseIntent(text, ctx.today);
  if (intent.intent === "help") return { message: t("chat.help"), ui: [] };
  const r = await runTool(ctx, intent.tool, intent.input);
  const block = r.ui[0];
  switch (intent.intent) {
    case "summary": {
      if (block?.type !== "summary") break;
      const top = block.topCategories[0];
      const topName = top ? (top.name ? categoryLabel({ name: top.name, systemKey: top.systemKey }, lang) : t("common.uncategorized")) : null;
      const range = block.range.start === block.range.end ? block.range.start : `${block.range.start} – ${block.range.end}`;
      if (block.count === 0) return { message: t("chat.r.no_data", { range }), ui: r.ui };
      const parts = [
        intent.focus !== "income" ? t("chat.r.spent", { range, amount: fmt(block.expense) }) : null,
        intent.focus !== "expense" ? t("chat.r.earned", { amount: fmt(block.income) }) : null,
        intent.focus === "both" ? t("chat.r.net", { amount: formatMoney(block.net, cur, lang, { sign: true }) }) : null,
        topName && block.expense > 0 && intent.focus !== "income" ? t("chat.r.top", { name: topName, amount: fmt(top!.amount) }) : null,
      ].filter(Boolean);
      return { message: parts.join(" "), ui: r.ui };
    }
    case "categories": {
      if (block?.type !== "categories") break;
      const top = block.items[0];
      if (!top) return { message: t("chat.r.no_expenses"), ui: r.ui };
      const name = top.name ? categoryLabel({ name: top.name, systemKey: top.systemKey }, lang) : t("common.uncategorized");
      return { message: t("chat.r.most", { name, amount: fmt(top.amount), share: Math.round(top.share * 100) }), ui: r.ui };
    }
    case "compare": {
      if (block?.type !== "comparison") break;
      const ch = block.change.expense;
      return {
        message: t("chat.r.compare", { current: fmt(block.current.expense), previous: fmt(block.previous.expense) }) + " " +
          (ch === null ? t("chat.r.no_baseline") : t(ch >= 0 ? "chat.r.up" : "chat.r.down", { pct: Math.abs(ch) })),
        ui: r.ui,
      };
    }
    case "balances": {
      if (block?.type !== "accounts") break;
      return { message: t("chat.r.balances", { cash: fmt(block.availableCash), worth: fmt(block.netWorth), count: block.accounts.length }), ui: r.ui };
    }
    case "savings": {
      if (block?.type !== "goals") break;
      if (!block.items.length) return { message: t("chat.r.no_goals"), ui: [{ type: "action", action: "create_goal" }] };
      return { message: t("chat.r.goals", { count: block.items.length }), ui: r.ui };
    }
    case "budgets": {
      if (block?.type !== "budgets") break;
      if (!block.items.length) return { message: t("chat.r.no_budgets"), ui: [{ type: "action", action: "create_budget", prefill: { period: "monthly" } }] };
      return { message: t("chat.r.budgets", { over: block.items.filter((b) => b.remaining < 0).length, count: block.items.length }), ui: r.ui };
    }
    case "find": {
      if (block?.type !== "transactions") break;
      return { message: t("chat.r.found", { count: block.total ?? block.items.length }), ui: r.ui };
    }
    case "add":
      return { message: t("chat.r.form_ready"), ui: r.ui };
    case "create_account":
      return { message: t("chat.r.account_form"), ui: r.ui };
    case "create_budget":
      return { message: t("chat.r.budget_form"), ui: r.ui };
    case "scan":
      return { message: t("chat.r.scanner"), ui: r.ui };
    case "report":
      return { message: t("chat.r.report"), ui: r.ui };
  }
  return { message: t("chat.help"), ui: r.ui };
}
