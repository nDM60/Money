import { route } from "@/server/http";
import { aiConfigured } from "@/server/ai";
import { emailConfigured, pushConfigured } from "@/server/services/notifications";
import { googleConfigured } from "@/server/services/sheets";
import { schedulerState } from "@/server/services/scheduler";

/** Honest integration status for the Settings screen. */
export const GET = route(async () => ({
  ai: aiConfigured(),
  push: pushConfigured(),
  email: emailConfigured(),
  sheets: googleConfigured(),
  cron: !!process.env.CRON_SECRET || process.env.INTERNAL_SCHEDULER === "true",
  internalScheduler: process.env.INTERNAL_SCHEDULER === "true",
  database: process.env.DATABASE_URL ? "postgres" : "embedded",
  scheduler: await schedulerState(),
}));
