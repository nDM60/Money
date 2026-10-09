import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { badRequest, route } from "@/server/http";
import { CURRENCY_CODES } from "@/lib/money";
import { isDateStr } from "@/lib/dates";
import { audit } from "@/server/services/common";

const input = z.object({
  base: z.enum(CURRENCY_CODES as [string, ...string[]]),
  quote: z.enum(CURRENCY_CODES as [string, ...string[]]),
  rate: z.string().regex(/^\d{1,12}(\.\d{1,12})?$/),
  effectiveDate: z.string().refine(isDateStr),
});

export const GET = route(async ({ user }) => {
  const db = await getDb();
  return db.select().from(schema.exchangeRates).where(eq(schema.exchangeRates.userId, user.id)).orderBy(desc(schema.exchangeRates.effectiveDate));
});

export const POST = route(async ({ user, body }) => {
  const r = await body(input);
  if (r.base === r.quote) throw badRequest("same_currency");
  if (/^0+(\.0+)?$/.test(r.rate)) throw badRequest("invalid_rate");
  const db = await getDb();
  const [row] = await db.insert(schema.exchangeRates).values({ userId: user.id, ...r }).returning();
  await audit(db, user.id, "exchange_rate", row.id, "create", undefined, row);
  return row;
});
