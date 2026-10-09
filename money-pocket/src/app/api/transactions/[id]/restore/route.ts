import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { restoreTransaction } from "@/server/services/transactions";

export const POST = route<{ id: string }>(async ({ user, params }) => restoreTransaction(await getDb(), user.id, assertUuid(params.id)));
