import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { googleConfigured } from "@/server/services/sheets";

const where = (userId: string) => and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google_sheets"));

export const GET = route(async ({ user }) => {
  const db = await getDb();
  const [i] = await db.select().from(schema.integrations).where(where(user.id));
  const jobs = await db.select().from(schema.syncJobs).where(eq(schema.syncJobs.userId, user.id)).orderBy(desc(schema.syncJobs.startedAt)).limit(10);
  return {
    configured: googleConfigured(),
    connected: !!i,
    spreadsheetId: i?.spreadsheetId ?? null,
    spreadsheetUrl: i?.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${i.spreadsheetId}/edit` : null,
    autoSync: i?.autoSync ?? true,
    dirty: i?.dirty ?? false,
    lastSyncAt: i?.lastSyncAt ?? null,
    lastError: i?.lastError ?? null,
    jobs,
  };
});

export const PATCH = route(async ({ user, body }) => {
  const { autoSync } = await body(z.object({ autoSync: z.boolean() }));
  const db = await getDb();
  await db.update(schema.integrations).set({ autoSync }).where(where(user.id));
  return { ok: true };
});

/** Disconnect: forget tokens. The spreadsheet itself stays in the user's Google Drive. */
export const DELETE = route(async ({ user }) => {
  const db = await getDb();
  await db.delete(schema.integrations).where(where(user.id));
  return { ok: true };
});
