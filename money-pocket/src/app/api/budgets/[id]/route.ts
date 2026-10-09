import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { budgetInput, deleteBudget, updateBudget } from "@/server/services/budgets";

type P = { id: string };
export const PATCH = route<P>(async ({ user, params, body }) => updateBudget(await getDb(), user.id, assertUuid(params.id), await body(budgetInput.partial())));
export const DELETE = route<P>(async ({ user, params }) => {
  await deleteBudget(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
