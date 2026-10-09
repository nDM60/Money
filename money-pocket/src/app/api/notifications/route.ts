import { z } from "zod";
import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { listNotifications, markRead } from "@/server/services/notifications";

export const GET = route(async ({ user }) => listNotifications(await getDb(), user.id));

export const POST = route(async ({ user, body }) => {
  const { id } = await body(z.object({ id: z.string().uuid().optional() }));
  await markRead(await getDb(), user.id, id);
  return { ok: true };
});
