import { z } from "zod";
import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { isDateStr } from "@/lib/dates";
import { duplicateTransaction } from "@/server/services/transactions";
import { userToday } from "@/server/services/settings";

export const POST = route<{ id: string }>(async ({ user, params, body }) => {
  const db = await getDb();
  const { date } = await body(z.object({ date: z.string().refine(isDateStr).optional() }));
  return duplicateTransaction(db, user.id, assertUuid(params.id), date ?? (await userToday(user.id, db)));
});
