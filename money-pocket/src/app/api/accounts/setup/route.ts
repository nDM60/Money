import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { isDateStr } from "@/lib/dates";
import { accountInput, createAccount } from "@/server/services/accounts";

/** Onboarding: create several accounts with their current actual balances (opening balances, not income). */
const input = z.object({
  effectiveDate: z.string().refine(isDateStr),
  accounts: z.array(accountInput.omit({ openingDate: true })).max(30),
});

export const POST = route(async ({ user, body }) => {
  const { effectiveDate, accounts } = await body(input);
  const db = await getDb();
  const created = await db.transaction(async (tx) => {
    const out = [];
    for (const a of accounts) out.push(await createAccount(tx, user.id, { ...a, openingDate: effectiveDate }));
    await tx.update(schema.userSettings).set({ onboarded: true }).where(eq(schema.userSettings.userId, user.id));
    return out;
  });
  return { accounts: created };
});
