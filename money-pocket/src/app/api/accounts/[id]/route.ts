import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { accountBalances, accountPatch, deleteAccount, getAccount, updateAccount } from "@/server/services/accounts";

type P = { id: string };

export const GET = route<P>(async ({ user, params }) => {
  const db = await getDb();
  const a = await getAccount(db, user.id, assertUuid(params.id));
  const bal = await accountBalances(db, user.id);
  return { ...a, balance: bal.get(a.id) ?? a.openingBalance };
});

export const PATCH = route<P>(async ({ user, params, body }) => updateAccount(await getDb(), user.id, assertUuid(params.id), await body(accountPatch)));

export const DELETE = route<P>(async ({ user, params }) => {
  await deleteAccount(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
