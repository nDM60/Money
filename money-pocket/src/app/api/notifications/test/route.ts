import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { notify } from "@/server/services/notifications";

export const POST = route(async ({ user }) => {
  const n = await notify(await getDb(), user.id, { kind: "test", dedupeKey: `test:${Date.now()}` });
  return { pushStatus: n?.pushStatus ?? null, emailStatus: n?.emailStatus ?? null };
}, { rateLimit: { name: "notif-test", limit: 10, windowSec: 3600 } });
