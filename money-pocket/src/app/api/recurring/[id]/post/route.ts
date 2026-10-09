import { z } from "zod";
import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { isDateStr } from "@/lib/dates";
import { postRecurring } from "@/server/services/recurring";

const input = z.object({
  skip: z.boolean().optional(),
  amount: z.number().int().positive().optional(),
  date: z.string().refine(isDateStr).optional(),
});

/** Explicit user action: post (or skip) the next occurrence. */
export const POST = route<{ id: string }>(async ({ user, params, body }) => postRecurring(await getDb(), user.id, assertUuid(params.id), await body(input)));
