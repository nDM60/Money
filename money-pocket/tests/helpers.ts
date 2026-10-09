import { createMemoryDb, setDbForTests, type DB } from "@/server/db";
import { registerUser } from "@/server/services/users";
import { createSession, SESSION_COOKIE } from "@/server/auth";

/**
 * Fresh database per test file: embedded PGlite by default, or a real
 * PostgreSQL server when TEST_DATABASE_URL is set (schema is reset).
 */
export async function freshDb(): Promise<DB> {
  const db = process.env.TEST_DATABASE_URL ? await realPostgres(process.env.TEST_DATABASE_URL) : await createMemoryDb();
  setDbForTests(db);
  return db;
}

let n = 0;
export async function makeUser(db: DB, opts: { currency?: string; language?: "en" | "lo" | "th" | "vi" } = {}) {
  n++;
  const u = await registerUser(db, { email: `user${n}-${Date.now()}@example.com`, password: "correct horse battery", name: `User ${n}`, currency: opts.currency ?? "LAK", language: opts.language ?? "en", timezone: "Asia/Vientiane" });
  const { token } = await createSession(u.id);
  return { user: u, cookie: `${SESSION_COOKIE}=${token}` };
}

export function req(url: string, cookie: string, init: { method?: string; body?: unknown } = {}) {
  return new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { cookie, "content-type": "application/json", host: "localhost" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export function params(p: Record<string, string>) {
  return { params: Promise.resolve(p) };
}

async function realPostgres(url: string): Promise<DB> {
  const pg = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { schema } = await import("@/server/db");
  const pool = new pg.default.Pool({ connectionString: url });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as DB;
}
