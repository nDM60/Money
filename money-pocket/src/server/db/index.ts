import crypto from "node:crypto";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations.generated";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

type Holder = { db?: Promise<DB>; override?: DB };
const g = globalThis as unknown as { __mpdb?: Holder };
const holder: Holder = (g.__mpdb ??= {});

/**
 * Apply migrations from the bundled copy (src/server/db/migrations.generated.ts)
 * using Drizzle's migration bookkeeping, so no files are read at runtime.
 */
export async function runMigrations(db: DB) {
  const meta = MIGRATIONS.map((m) => ({
    sql: m.sql.split("--> statement-breakpoint"),
    bps: m.breakpoints,
    folderMillis: m.when,
    hash: crypto.createHash("sha256").update(m.sql).digest("hex"),
  }));
  const d = db as unknown as { dialect: { migrate: (m: unknown, s: unknown, c: unknown) => Promise<void> }; session: unknown };
  await d.dialect.migrate(meta, d.session, { migrationsFolder: "" });
}

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
    const db = drizzle(pool, { schema }) as unknown as DB;
    await runMigrations(db);
    return db;
  }
  // Zero-config local mode: embedded Postgres (PGlite) persisted on disk.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  const client = new PGlite(dir === "memory" ? undefined : dir);
  const db = drizzle(client, { schema }) as unknown as DB;
  await runMigrations(db);
  return db;
}

export function getDb(): Promise<DB> {
  if (holder.override) return Promise.resolve(holder.override);
  if (!holder.db) {
    holder.db = connect().catch((e) => {
      holder.db = undefined;
      throw e;
    });
  }
  return holder.db;
}

/** Test hook: use a specific database instance. */
export function setDbForTests(db: DB | undefined) {
  holder.override = db;
}

export async function createMemoryDb(): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await runMigrations(db);
  return db;
}
