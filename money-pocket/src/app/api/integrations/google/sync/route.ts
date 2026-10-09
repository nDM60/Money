import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { syncUser } from "@/server/services/sheets";

export const POST = route(async ({ user }) => syncUser(await getDb(), user.id, "manual"), { rateLimit: { name: "sync", limit: 30, windowSec: 3600 } });
