import { and, eq } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Exec = DB | Tx;

export async function audit(
  db: Exec,
  userId: string,
  entity: string,
  entityId: string | null,
  action: string,
  before?: unknown,
  after?: unknown,
) {
  await db.insert(schema.auditLog).values({
    userId, entity, entityId, action,
    before: before === undefined ? null : JSON.parse(JSON.stringify(before)),
    after: after === undefined ? null : JSON.parse(JSON.stringify(after)),
  });
}

/** Mark the user's spreadsheet integration as needing a sync. */
export async function markSyncDirty(db: Exec, userId: string) {
  await db.update(schema.integrations).set({ dirty: true }).where(and(eq(schema.integrations.userId, userId)));
}
