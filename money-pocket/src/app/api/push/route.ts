import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { pushConfigured } from "@/server/services/notifications";

const sub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

export const GET = route(async () => ({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null }), { public: true });

export const POST = route(async ({ user, body }) => {
  const s = await body(sub);
  const db = await getDb();
  await db.insert(schema.pushSubscriptions).values({ userId: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { userId: user.id, p256dh: s.keys.p256dh, auth: s.keys.auth } });
  return { ok: true };
});

export const DELETE = route(async ({ user, body }) => {
  const { endpoint } = await body(z.object({ endpoint: z.string().max(1000) }));
  const db = await getDb();
  await db.delete(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.userId, user.id), eq(schema.pushSubscriptions.endpoint, endpoint)));
  return { ok: true };
});
