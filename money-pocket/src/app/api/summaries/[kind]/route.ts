import { getDb } from "@/server/db";
import { notFound, route } from "@/server/http";
import { isDateStr } from "@/lib/dates";
import { buildSummary, type SummaryKind } from "@/server/services/summaries";
import { userToday } from "@/server/services/settings";

export const GET = route<{ kind: string }>(async ({ user, params, query }) => {
  if (!["daily", "weekly", "monthly", "yearly"].includes(params.kind)) throw notFound();
  const db = await getDb();
  const today = await userToday(user.id, db);
  const d = query.get("date");
  const anchor = isDateStr(d) && d <= today ? d : today;
  return buildSummary(db, user.id, params.kind as SummaryKind, anchor);
});
