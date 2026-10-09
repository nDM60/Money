import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db";
import { LANGUAGES } from "@/lib/domain";
import { CURRENCY_CODES } from "@/lib/money";
import { isValidTimeZone } from "@/lib/dates";
import { HttpError } from "../http";
import { findUserByEmail, hashPassword } from "../auth";
import type { Exec } from "./common";
import { seedNewUser } from "./settings";

export const registerInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(80).default(""),
  language: z.enum(LANGUAGES).default("en"),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]).default("LAK"),
  timezone: z.string().max(60).refine(isValidTimeZone).default("Asia/Vientiane"),
});

export async function registerUser(db: Exec, input: z.input<typeof registerInput>, opts: { isDemo?: boolean } = {}) {
  const data = registerInput.parse(input);
  if (await findUserByEmail(data.email)) throw new HttpError(409, "email_taken");
  const passwordHash = await hashPassword(data.password);
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(schema.users).values({ email: data.email, passwordHash, name: data.name, isDemo: !!opts.isDemo }).returning();
    await seedNewUser(tx, u.id, { language: data.language, currency: data.currency, timezone: data.timezone });
    return u;
  });
}

/** Permanently delete a user and every record they own (cascades). */
export async function deleteUser(db: Exec, userId: string) {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

export function demoCredentials() {
  return { email: `demo-${crypto.randomBytes(6).toString("hex")}@demo.moneypocket.local`, password: crypto.randomBytes(18).toString("base64url") };
}
