import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "../db";
import { translate } from "@/lib/i18n";
import { categoryLabel } from "@/lib/i18n/categories";
import { formatMoney } from "@/lib/money";
import type { Lang } from "@/lib/domain";
import type { Exec } from "./common";
import { getSettings, userToday } from "./settings";
import { budgetStatus } from "./reports";

export type NotificationKind =
  | "daily_summary" | "weekly_report" | "monthly_report" | "budget_threshold" | "bill_due" | "bill_overdue"
  | "uncategorized" | "goal_completed" | "unusual_spending" | "test";

export interface NotifyInput {
  kind: NotificationKind;
  dedupeKey?: string;
  vars?: Record<string, string | number>;
  data?: Record<string, unknown>;
}

export function renderNotification(kind: NotificationKind, vars: Record<string, string | number>, lang: Lang) {
  return {
    title: translate(lang, `notif.${kind}.title` as never, vars),
    body: translate(lang, `notif.${kind}.body` as never, vars),
  };
}

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}
export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Create an in-app notification (deduplicated) and deliver it through the
 * channels the user enabled and the server has configured.
 */
export async function notify(db: Exec, userId: string, input: NotifyInput) {
  const s = await getSettings(userId, db);
  const lang = s.language as Lang;
  const { title, body } = renderNotification(input.kind, input.vars ?? {}, lang);
  const rows = await db.insert(schema.notifications).values({
    userId, kind: input.kind, title, body, data: input.data ?? null, dedupeKey: input.dedupeKey ?? null,
  }).onConflictDoNothing().returning();
  const n = rows[0];
  if (!n) return null; // already sent
  let pushStatus: string | null = null;
  let emailStatus: string | null = null;
  if (s.channelPush) pushStatus = await deliverPush(db, userId, { title, body, url: (input.data?.url as string) ?? "/notifications", tag: input.kind });
  if (s.channelEmail) emailStatus = await deliverEmail(db, userId, title, body);
  if (pushStatus || emailStatus) {
    await db.update(schema.notifications).set({ pushStatus, emailStatus }).where(eq(schema.notifications.id, n.id));
  }
  return { ...n, pushStatus, emailStatus };
}

async function deliverPush(db: Exec, userId: string, payload: { title: string; body: string; url: string; tag: string }) {
  if (!pushConfigured()) return "not_configured";
  const subs = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
  if (!subs.length) return "no_subscription";
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id));
      else console.error("push failed", code);
    }
  }
  return sent > 0 ? `sent:${sent}` : "failed";
}

async function deliverEmail(db: Exec, userId: string, subject: string, text: string) {
  if (!emailConfigured()) return "not_configured";
  const [u] = await db.select({ email: schema.users.email, isDemo: schema.users.isDemo }).from(schema.users).where(eq(schema.users.id, userId));
  if (!u || u.isDemo) return "skipped";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: u.email, subject: `Money Pocket · ${subject}`, text }),
    });
    return res.ok ? "sent" : `failed:${res.status}`;
  } catch {
    return "failed";
  }
}

/** Notify once per budget window for the highest threshold crossed. */
export async function checkBudgetAlerts(db: Exec, userId: string) {
  const s = await getSettings(userId, db);
  if (!s.notifyBudget) return;
  const today = await userToday(userId, db);
  const status = await budgetStatus(db, userId, today);
  const cats = await db.select().from(schema.categories).where(eq(schema.categories.userId, userId));
  for (const b of status) {
    const pct = b.available > 0 ? Math.floor((b.spent / b.available) * 100) : 0;
    const crossed = [...b.thresholds].sort((x, y) => y - x).find((th) => pct >= th);
    if (!crossed) continue;
    const cat = b.categoryId ? cats.find((c) => c.id === b.categoryId) : null;
    const lang = s.language as Lang;
    await notify(db, userId, {
      kind: "budget_threshold",
      dedupeKey: `budget:${b.id}:${b.window.start}:${crossed}`,
      vars: {
        threshold: crossed,
        name: cat ? categoryLabel(cat, lang) : translate(lang, "budgets.overall"),
        spent: formatMoney(b.spent, s.primaryCurrency, lang),
        limit: formatMoney(b.available, s.primaryCurrency, lang),
      },
      data: { url: "/budgets", budgetId: b.id },
    });
  }
}

export async function listNotifications(db: Exec, userId: string, limit = 50) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)).orderBy(desc(schema.notifications.createdAt)).limit(limit);
}

export async function unreadCount(db: Exec, userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return Number(r?.n ?? 0);
}

export async function markRead(db: Exec, userId: string, id?: string) {
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(
    eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt), id ? eq(schema.notifications.id, id) : undefined,
  ));
}
