import { z } from "zod";
import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { chat } from "@/server/services/chat";

const input = z.object({ message: z.string().trim().min(1).max(2000), sessionId: z.string().uuid().optional() });

/** The assistant only uses predefined, user-scoped tools; it cannot change data. */
export const POST = route(async ({ user, body }) => {
  const { message, sessionId } = await body(input);
  return chat(await getDb(), user.id, message, sessionId);
}, { rateLimit: { name: "chat", limit: 60, windowSec: 3600 } });
