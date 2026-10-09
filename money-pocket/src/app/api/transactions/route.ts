import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { createTransaction, listQuery, listTransactions, txInput } from "@/server/services/transactions";

export const GET = route(async ({ user, query }) => listTransactions(await getDb(), user.id, listQuery.parse(Object.fromEntries(query))));

export const POST = route(async ({ user, body }) => createTransaction(await getDb(), user.id, await body(txInput)));
