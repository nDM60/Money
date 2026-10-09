import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { deleteGoal, goalActivity, goalInput, updateGoal } from "@/server/services/goals";

type P = { id: string };
export const GET = route<P>(async ({ user, params }) => goalActivity(await getDb(), user.id, assertUuid(params.id)));
export const PATCH = route<P>(async ({ user, params, body }) => updateGoal(await getDb(), user.id, assertUuid(params.id), await body(goalInput.partial())));
export const DELETE = route<P>(async ({ user, params }) => {
  await deleteGoal(await getDb(), user.id, assertUuid(params.id));
  return { ok: true };
});
