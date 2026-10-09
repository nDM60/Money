import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { createGoal, goalInput, listGoals } from "@/server/services/goals";

export const GET = route(async ({ user }) => listGoals(await getDb(), user.id));
export const POST = route(async ({ user, body }) => createGoal(await getDb(), user.id, await body(goalInput)));
