import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { accountInput, createAccount, listAccounts } from "@/server/services/accounts";

export const GET = route(async ({ user, query }) => listAccounts(await getDb(), user.id, { includeArchived: query.get("archived") === "1" }));

export const POST = route(async ({ user, body }) => createAccount(await getDb(), user.id, await body(accountInput)));
