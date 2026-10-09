import { z } from "zod";
import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { isDateStr } from "@/lib/dates";
import { reconcileAccount } from "@/server/services/accounts";

const input = z.object({
  actualBalance: z.number().int().refine(Number.isSafeInteger),
  date: z.string().refine(isDateStr).optional(),
  note: z.string().max(200).nullish(),
});

export const POST = route<{ id: string }>(async ({ user, params, body }) =>
  reconcileAccount(await getDb(), user.id, assertUuid(params.id), await body(input)));
