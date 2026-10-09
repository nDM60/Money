import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { createSession, sessionCookie } from "@/server/auth";
import { registerInput, registerUser } from "@/server/services/users";

export const POST = route(async ({ body }) => {
  const input = await body(registerInput);
  const db = await getDb();
  const u = await registerUser(db, input);
  const { token, expiresAt } = await createSession(u.id);
  return new Response(JSON.stringify({ id: u.id }), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(token, expiresAt) } });
}, { public: true, rateLimit: { name: "register", limit: 10, windowSec: 3600 } });
