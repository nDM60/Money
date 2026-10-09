import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { deleteHolding, holdingInput, updateHolding, valuationInput } from "@/server/services/goals";

type P = { id: string };
export const PATCH = route<P>(async ({ user, params, body }) =>
  updateHolding(await getDb(), user.id, assertUuid(params.id), await body(holdingInput.omit({ accountId: true }).partial().merge(valuationInput.partial()))));
export const DELETE = route<P>(async ({ user, params }) => {
  await deleteHolding(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
