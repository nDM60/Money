import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createMemoryDb, runMigrations, schema } from "@/server/db";
import { MIGRATIONS } from "@/server/db/migrations.generated";

describe("bundled migrations", () => {
  it("match the drizzle/ folder (run `npm run db:generate` after schema changes)", () => {
    const journal = JSON.parse(fs.readFileSync(path.join("drizzle", "meta", "_journal.json"), "utf8"));
    expect(MIGRATIONS.map((m) => m.tag)).toEqual(journal.entries.map((e: { tag: string }) => e.tag));
    for (const m of MIGRATIONS) expect(m.sql).toBe(fs.readFileSync(path.join("drizzle", `${m.tag}.sql`), "utf8"));
    // The generator is a no-op when everything is in sync.
    expect(execFileSync("node", ["scripts/bundle-migrations.mjs"]).toString()).toBe("");
  });

  it("are safe to run again on an existing database (every serverless cold start runs them)", async () => {
    const db = await createMemoryDb();
    await db.insert(schema.users).values({ email: "a@b.c", passwordHash: "x" });
    await runMigrations(db);
    await runMigrations(db);
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });
});
