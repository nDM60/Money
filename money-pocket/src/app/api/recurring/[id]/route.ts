import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { deleteRecurring, recurringInput, updateRecurring } from "@/server/services/recurring";

type P = { id: string };
export const PATCH = route<P>(async ({ user, params, body }) => updateRecurring(await getDb(), user.id, assertUuid(params.id), await body(recurringInput.partial())));
export const DELETE = route<P>(async ({ user, params }) => {
  await deleteRecurring(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
