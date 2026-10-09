import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { createRecurring, listRecurring, recurringInput } from "@/server/services/recurring";

export const GET = route(async ({ user }) => listRecurring(await getDb(), user.id));
export const POST = route(async ({ user, body }) => createRecurring(await getDb(), user.id, await body(recurringInput)));
