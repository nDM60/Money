import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, makeUser } from "./helpers";
import type { DB } from "@/server/db";
import { createAccount, listAccounts, reconcileAccount } from "@/server/services/accounts";
import { createTransaction } from "@/server/services/transactions";
import { dashboard } from "@/server/services/reports";
import { todayIn } from "@/lib/dates";
import { seedDemo } from "@/server/services/demo";
import { registerUser } from "@/server/services/users";

let db: DB;
beforeAll(async () => { db = await freshDb(); });

describe("engine smoke", () => {
  it("opening balance, expense, transfer", async () => {
    const { user } = await makeUser(db);
    const today = todayIn("Asia/Vientiane");
    const a = await createAccount(db, user.id, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 5_000_000 });
    const s = await createAccount(db, user.id, { name: "Savings", type: "savings", currency: "LAK", openingBalance: 0 });
    let d = await dashboard(db, user.id, { period: "month", today });
    expect(d.totals.income).toBe(0);
    expect(d.overview.netWorth).toBe(5_000_000);
    await createTransaction(db, user.id, { type: "expense", amount: 100_000, currency: "LAK", fromAccountId: a.id, date: today });
    await createTransaction(db, user.id, { type: "transfer", amount: 500_000, currency: "LAK", fromAccountId: a.id, toAccountId: s.id, date: today });
    const accs = await listAccounts(db, user.id);
    expect(accs.find((x) => x.id === a.id)!.balance).toBe(4_400_000);
    expect(accs.find((x) => x.id === s.id)!.balance).toBe(500_000);
    d = await dashboard(db, user.id, { period: "month", today });
    expect(d.totals.income).toBe(0);
    expect(d.totals.expense).toBe(100_000);
    const snap = await reconcileAccount(db, user.id, a.id, { actualBalance: 4_390_000 });
    expect(snap.difference).toBe(-10_000);
    d = await dashboard(db, user.id, { period: "month", today });
    expect(d.totals.expense).toBe(100_000);
  });
  it("seeds demo", async () => {
    const u = await registerUser(db, { email: "demo@x.local", password: "12345678abc" }, { isDemo: true });
    await seedDemo(db, u.id);
    const d = await dashboard(db, u.id, { period: "year", today: todayIn("Asia/Vientiane") });
    expect(d.totals.income).toBeGreaterThan(0);
    expect(d.missingRates).toEqual([]);
  });
});
