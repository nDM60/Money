import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { listSessions } from "@/server/services/chat";

export const GET = route(async ({ user }) => listSessions(await getDb(), user.id));
