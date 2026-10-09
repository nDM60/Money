import { z } from "zod";
import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { isDateStr, PERIODS, type Period } from "@/lib/dates";
import { dashboard } from "@/server/services/reports";
import { userToday } from "@/server/services/settings";

const q = z.object({
  period: z.enum(PERIODS as [Period, ...Period[]]).default("month"),
  start: z.string().refine(isDateStr).optional(),
  end: z.string().refine(isDateStr).optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
});

export const GET = route(async ({ user, query }) => {
  const db = await getDb();
  const p = q.parse(Object.fromEntries(query));
  return dashboard(db, user.id, { ...p, today: await userToday(user.id, db) });
});
