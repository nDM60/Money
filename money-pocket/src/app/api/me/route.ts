import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { getSettings } from "@/server/services/settings";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/budgets";
import { unreadCount } from "@/server/services/notifications";
import { aiConfigured } from "@/server/ai";

export const GET = route(async ({ user }) => {
  const db = await getDb();
  const [settings, accounts, categories, unread] = await Promise.all([
    getSettings(user.id, db), listAccounts(db, user.id, { includeArchived: true }), listCategories(db, user.id), unreadCount(db, user.id),
  ]);
  return { user, settings, accounts, categories, unread, features: { ai: aiConfigured() } };
});

export const DELETE = route(async ({ user, body }) => {
  const { z } = await import("zod");
  await body(z.object({ confirm: z.literal("DELETE") }));
  const db = await getDb();
  const { deleteUser } = await import("@/server/services/users");
  await deleteUser(db, user.id);
  const { clearSessionCookie } = await import("@/server/auth");
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": clearSessionCookie() } });
}, { rateLimit: { name: "delete-account", limit: 3, windowSec: 3600 } });
