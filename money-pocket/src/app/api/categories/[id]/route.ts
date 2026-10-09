import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { categoryInput, deleteCategory, updateCategory } from "@/server/services/budgets";

type P = { id: string };
export const PATCH = route<P>(async ({ user, params, body }) =>
  updateCategory(await getDb(), user.id, assertUuid(params.id), await body(categoryInput.partial().extend({ archived: (await import("zod")).z.boolean().optional() }))));
export const DELETE = route<P>(async ({ user, params }) => ({ archived: (await deleteCategory(await getDb(), user.id, assertUuid(params.id))) !== null }));
