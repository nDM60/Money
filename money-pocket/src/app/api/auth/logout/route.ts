import { route } from "@/server/http";
import { clearSessionCookie, deleteSession, readCookie, SESSION_COOKIE } from "@/server/auth";

export const POST = route(async ({ req }) => {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (token) await deleteSession(token);
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": clearSessionCookie() } });
}, { public: true });
