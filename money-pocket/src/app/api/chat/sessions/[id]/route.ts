import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { deleteSession, sessionMessages } from "@/server/services/chat";

type P = { id: string };
export const GET = route<P>(async ({ user, params }) => sessionMessages(await getDb(), user.id, assertUuid(params.id)));
export const DELETE = route<P>(async ({ user, params }) => {
  await deleteSession(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
