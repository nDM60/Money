import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { addDays, isDateStr, startOfMonth } from "@/lib/dates";
import { accountBalances, getAccount, listSnapshots } from "@/server/services/accounts";
import { userToday } from "@/server/services/settings";

/** Account statement with running balance, plus balance snapshots. */
export const GET = route<{ id: string }>(async ({ user, params, query }) => {
  const db = await getDb();
  const acc = await getAccount(db, user.id, assertUuid(params.id));
  const today = await userToday(user.id, db);
  let start = query.get("start") ?? startOfMonth(today);
  const end = query.get("end") ?? today;
  if (!isDateStr(start) || !isDateStr(end)) start = startOfMonth(today);
  if (start < acc.openingDate) start = acc.openingDate;
  const opening = start <= acc.openingDate ? acc.openingBalance : (await accountBalances(db, user.id, addDays(start, -1))).get(acc.id) ?? 0;
  const t = schema.transactions;
  const rows = await db.select().from(t).where(and(
    eq(t.userId, user.id), isNull(t.deletedAt), gte(t.localDate, start), lte(t.localDate, end),
    or(eq(t.fromAccountId, acc.id), eq(t.toAccountId, acc.id)),
  )).orderBy(asc(t.localDate), asc(t.occurredAt), asc(t.createdAt));
  let bal = opening;
  const lines = rows.map((r) => {
    const delta = (r.toAccountId === acc.id ? r.toAmount ?? 0 : 0) - (r.fromAccountId === acc.id ? r.fromAmount ?? 0 : 0);
    bal += delta;
    return { ...r, delta, balance: bal };
  });
  return { account: acc, start, end, opening, closing: bal, lines, snapshots: await listSnapshots(db, user.id, acc.id) };
});
