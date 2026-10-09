import { HttpError, route } from "@/server/http";
import { randomToken } from "@/server/crypto";
import { authUrl, googleConfigured } from "@/server/services/sheets";

export const GET = route(async () => {
  if (!googleConfigured()) throw new HttpError(503, "google_not_configured");
  const state = randomToken();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: { location: authUrl(state), "set-cookie": `mp_oauth_state=${state}; Path=/api/integrations/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}` },
  });
});
