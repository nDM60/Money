import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { categoryInput, createCategory, listCategories } from "@/server/services/budgets";

export const GET = route(async ({ user }) => listCategories(await getDb(), user.id));
export const POST = route(async ({ user, body }) => createCategory(await getDb(), user.id, await body(categoryInput)));
