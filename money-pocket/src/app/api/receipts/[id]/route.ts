import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { deleteReceipt, getReceipt } from "@/server/services/receipts";

type P = { id: string };
export const GET = route<P>(async ({ user, params }) => getReceipt(await getDb(), user.id, assertUuid(params.id)));
export const DELETE = route<P>(async ({ user, params }) => {
  await deleteReceipt(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
