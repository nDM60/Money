import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { extractReceipt } from "@/server/services/receipts";

export const POST = route<{ id: string }>(async ({ user, params }) => extractReceipt(await getDb(), user.id, assertUuid(params.id)),
  { rateLimit: { name: "extract", limit: 30, windowSec: 3600 } });
export const maxDuration = 60;
