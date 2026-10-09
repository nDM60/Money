import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { createHolding, holdingInput, listHoldings } from "@/server/services/goals";

export const GET = route(async ({ user }) => listHoldings(await getDb(), user.id));
export const POST = route(async ({ user, body }) => createHolding(await getDb(), user.id, await body(holdingInput)));
