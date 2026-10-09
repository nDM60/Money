import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { deleteTransaction, getTransaction, txInput, updateTransaction } from "@/server/services/transactions";

type P = { id: string };

export const GET = route<P>(async ({ user, params }) => getTransaction(await getDb(), user.id, assertUuid(params.id)));

export const PATCH = route<P>(async ({ user, params, body }) => updateTransaction(await getDb(), user.id, assertUuid(params.id), await body(txInput.partial())));

export const DELETE = route<P>(async ({ user, params }) => {
  await deleteTransaction(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
