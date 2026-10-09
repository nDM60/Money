import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { assertUuid, notFound, route } from "@/server/http";
import { audit } from "@/server/services/common";

/** Removing a rate only affects future conversions; stored transactions keep their snapshot. */
export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  const db = await getDb();
  const [row] = await db.delete(schema.exchangeRates).where(and(eq(schema.exchangeRates.id, assertUuid(params.id)), eq(schema.exchangeRates.userId, user.id))).returning();
  if (!row) throw notFound();
  await audit(db, user.id, "exchange_rate", row.id, "delete", row);
  return { ok: true };
});
