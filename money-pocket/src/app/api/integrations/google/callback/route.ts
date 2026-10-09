import { getDb } from "@/server/db";
import { currentUser } from "@/server/http";
import { readCookie } from "@/server/auth";
import { connectWithCode, syncUser } from "@/server/services/sheets";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (status: string) => new Response(null, {
    status: 302,
    headers: { location: `/settings?sheets=${status}`, "set-cookie": "mp_oauth_state=; Path=/api/integrations/google; Max-Age=0" },
  });
  const user = await currentUser(req);
  if (!user) return back("unauthorized");
  const state = url.searchParams.get("state");
  if (!state || state !== readCookie(req.headers.get("cookie"), "mp_oauth_state")) return back("bad_state");
  const code = url.searchParams.get("code");
  if (!code) return back(url.searchParams.get("error") ?? "denied");
  const db = await getDb();
  try {
    await connectWithCode(db, user.id, code);
    const job = await syncUser(db, user.id, "manual");
    return back(job.status === "success" ? "connected" : "sync_error");
  } catch (e) {
    console.error(e);
    return back("error");
  }
}
