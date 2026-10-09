import { runTick } from "@/server/services/scheduler";

/**
 * Server-side scheduler entry point. Call every 5–15 minutes from a cron
 * service (Vercel Cron, GitHub Actions, system cron) with
 * `Authorization: Bearer $CRON_SECRET`.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_not_configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  const state = await runTick();
  return Response.json(state);
}

export const GET = handle;
export const POST = handle;
export const dynamic = "force-dynamic";
export const maxDuration = 60;
