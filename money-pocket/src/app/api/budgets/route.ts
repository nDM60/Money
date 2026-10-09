import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { budgetInput, createBudget, listBudgets } from "@/server/services/budgets";
import { budgetStatus, unusualCategories } from "@/server/services/reports";
import { userToday } from "@/server/services/settings";

export const GET = route(async ({ user }) => {
  const db = await getDb();
  const today = await userToday(user.id, db);
  const [budgets, status, unusual] = await Promise.all([listBudgets(db, user.id), budgetStatus(db, user.id, today), unusualCategories(db, user.id, today)]);
  return { budgets, status: status.map((s) => ({ ...s, ratio: Number.isFinite(s.ratio) ? s.ratio : null })), unusual };
});
export const POST = route(async ({ user, body }) => createBudget(await getDb(), user.id, await body(budgetInput)));
