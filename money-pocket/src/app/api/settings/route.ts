import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { LANGUAGES } from "@/lib/domain";
import { CURRENCY_CODES } from "@/lib/money";
import { isValidTimeZone } from "@/lib/dates";
import { getSettings } from "@/server/services/settings";

const patch = z.object({
  language: z.enum(LANGUAGES),
  primaryCurrency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  theme: z.enum(["system", "light", "dark"]),
  timezone: z.string().refine(isValidTimeZone),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  notifyDaily: z.boolean(), notifyWeekly: z.boolean(), notifyMonthly: z.boolean(), notifyBudget: z.boolean(),
  notifyBills: z.boolean(), notifyUncategorized: z.boolean(), channelPush: z.boolean(), channelEmail: z.boolean(),
  onboarded: z.boolean(),
}).partial();

export const GET = route(async ({ user }) => getSettings(user.id));

export const PATCH = route(async ({ user, body }) => {
  const p = await body(patch);
  const db = await getDb();
  await getSettings(user.id, db);
  const [s] = await db.update(schema.userSettings).set({ ...p, updatedAt: new Date() }).where(eq(schema.userSettings.userId, user.id)).returning();
  return s;
});
