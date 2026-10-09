import { z } from "zod";
import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { createSession, sessionCookie } from "@/server/auth";
import { LANGUAGES } from "@/lib/domain";
import { demoCredentials, registerUser } from "@/server/services/users";
import { seedDemo } from "@/server/services/demo";

/** Creates an isolated demo workspace with sample data (flagged is_demo). */
export const POST = route(async ({ body }) => {
  const { language } = await body(z.object({ language: z.enum(LANGUAGES).default("en") }));
  const db = await getDb();
  const creds = demoCredentials();
  const u = await registerUser(db, { ...creds, name: "Demo", language, currency: "LAK", timezone: "Asia/Vientiane" }, { isDemo: true });
  await seedDemo(db, u.id);
  const { token, expiresAt } = await createSession(u.id);
  return new Response(JSON.stringify({ id: u.id }), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(token, expiresAt) } });
}, { public: true, rateLimit: { name: "demo", limit: 5, windowSec: 3600 } });
