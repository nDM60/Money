import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { HttpError, route } from "@/server/http";
import { createSession, findUserByEmail, hashPassword, needsRehash, sessionCookie, verifyPassword } from "@/server/auth";

let dummyHash: Promise<string> | null = null;

const input = z.object({ email: z.string().trim().max(200), password: z.string().max(200) });

export const POST = route(async ({ body }) => {
  const { email, password } = await body(input);
  const u = await findUserByEmail(email);
  // Compare even when the user doesn't exist to keep timing similar.
  const ok = await verifyPassword(password, u?.passwordHash ?? (await (dummyHash ??= hashPassword("not-a-real-password"))));
  if (!u || !ok) throw new HttpError(401, "invalid_credentials");
  if (needsRehash(u.passwordHash)) {
    const db = await getDb();
    await db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, u.id));
  }
  const { token, expiresAt } = await createSession(u.id);
  return new Response(JSON.stringify({ id: u.id }), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(token, expiresAt) } });
}, { public: true, rateLimit: { name: "login", limit: 10, windowSec: 900 } });
