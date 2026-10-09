import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { discardReceipt } from "@/server/services/receipts";

export const POST = route<{ id: string }>(async ({ user, params }) => {
  await discardReceipt(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
