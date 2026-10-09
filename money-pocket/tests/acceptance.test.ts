/**
 * Acceptance tests 1–10 from the product brief. They exercise the real HTTP
 * route handlers against an embedded PostgreSQL (PGlite) database.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, makeUser, req, params } from "./helpers";
import type { DB } from "@/server/db";
import { todayIn, addDays, startOfMonth } from "@/lib/dates";
import { DICTS, translate } from "@/lib/i18n";
import { LANGUAGES } from "@/lib/domain";
import { summaryNarrative } from "@/lib/i18n/summary";
import { renderNotification } from "@/server/services/notifications";
import { buildSummary } from "@/server/services/summaries";
import { extractReceipt, type Extractor } from "@/server/services/receipts";
import { syncUser, type SheetsApi } from "@/server/services/sheets";
import { chat } from "@/server/services/chat";

import * as AccountsRoute from "@/app/api/accounts/route";
import * as AccountRoute from "@/app/api/accounts/[id]/route";
import * as SetupRoute from "@/app/api/accounts/setup/route";
import * as TxRoute from "@/app/api/transactions/route";
import * as TxItemRoute from "@/app/api/transactions/[id]/route";
import * as DashRoute from "@/app/api/dashboard/route";
import * as ReceiptsRoute from "@/app/api/receipts/route";
import * as LoginRoute from "@/app/api/auth/login/route";
import * as LogoutRoute from "@/app/api/auth/logout/route";
import * as RegisterRoute from "@/app/api/auth/register/route";
import * as MeRoute from "@/app/api/me/route";
import * as ChatRoute from "@/app/api/chat/route";

let db: DB;
const today = todayIn("Asia/Vientiane");
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const noParams = params({});

beforeAll(async () => {
  db = await freshDb();
});

async function createAccount(cookie: string, body: Record<string, unknown>) {
  const r = await json(await AccountsRoute.POST(req("/api/accounts", cookie, { method: "POST", body }), noParams));
  expect(r.status).toBe(200);
  return r.body as { id: string };
}
async function dashboard(cookie: string, period = "month") {
  const r = await json(await DashRoute.GET(req(`/api/dashboard?period=${period}`, cookie), noParams));
  expect(r.status).toBe(200);
  return r.body;
}
async function balanceOf(cookie: string, id: string) {
  const r = await json(await AccountRoute.GET(req(`/api/accounts/${id}`, cookie), params({ id })));
  return r.body.balance as number;
}

describe("Test 1 — opening balance is not income", () => {
  it("records 5,000,000 LAK as a balance with zero income", async () => {
    const { cookie } = await makeUser(db);
    const acc = await createAccount(cookie, { name: "Bank Account", type: "bank", currency: "LAK", openingBalance: 5_000_000 });
    expect(await balanceOf(cookie, acc.id)).toBe(5_000_000);
    const d = await dashboard(cookie);
    expect(d.totals.income).toBe(0);
    expect(d.overview.todayIncome).toBe(0);
    expect(d.overview.monthIncome).toBe(0);
    expect(d.overview.netWorth).toBe(5_000_000);
    // No transactions were created for the opening balance.
    const list = await json(await TxRoute.GET(req("/api/transactions", cookie), noParams));
    expect(list.body.total).toBe(0);
  });

  it("onboarding: several opening balances, total 35,000,000, income 0", async () => {
    const { cookie } = await makeUser(db);
    const r = await json(await SetupRoute.POST(req("/api/accounts/setup", cookie, {
      method: "POST",
      body: {
        effectiveDate: today,
        accounts: [
          { name: "Daily Expenses", type: "bank", currency: "LAK", openingBalance: 20_000_000 },
          { name: "Savings", type: "savings", currency: "LAK", openingBalance: 10_000_000 },
          { name: "Cash Wallet", type: "cash", currency: "LAK", openingBalance: 5_000_000 },
        ],
      },
    }), noParams));
    expect(r.status).toBe(200);
    let d = await dashboard(cookie);
    expect(d.overview.netWorth).toBe(35_000_000);
    expect(d.totals.income).toBe(0);
    // Transfer 2,000,000 Daily -> Savings: total unchanged, no income/expense.
    const [daily, savings] = r.body.accounts;
    await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "transfer", amount: 2_000_000, currency: "LAK", fromAccountId: daily.id, toAccountId: savings.id, date: today } }), noParams);
    d = await dashboard(cookie);
    expect(d.overview.netWorth).toBe(35_000_000);
    expect(d.totals.income).toBe(0);
    expect(d.totals.expense).toBe(0);
  });
});

describe("Test 2 & 3 — expense and internal transfer", () => {
  it("expense reduces balance and increases expenses; transfer does neither income nor expense", async () => {
    const { cookie } = await makeUser(db);
    const bank = await createAccount(cookie, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 5_000_000 });
    const sav = await createAccount(cookie, { name: "Savings", type: "savings", currency: "LAK", openingBalance: 0 });

    const exp = await json(await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "expense", amount: 100_000, currency: "LAK", fromAccountId: bank.id, date: today, description: "Lunch" } }), noParams));
    expect(exp.status).toBe(200);
    expect(await balanceOf(cookie, bank.id)).toBe(4_900_000);
    let d = await dashboard(cookie);
    expect(d.totals.expense).toBe(100_000);
    expect(d.totals.income).toBe(0);

    const tr = await json(await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "transfer", amount: 500_000, currency: "LAK", fromAccountId: bank.id, toAccountId: sav.id, date: today } }), noParams));
    expect(tr.status).toBe(200);
    expect(await balanceOf(cookie, bank.id)).toBe(4_400_000);
    expect(await balanceOf(cookie, sav.id)).toBe(500_000);
    d = await dashboard(cookie);
    expect(d.totals.expense).toBe(100_000);
    expect(d.totals.income).toBe(0);
    expect(d.overview.netWorth).toBe(4_900_000);
  });

  it("rejects invalid shapes (transfer to same account, expense with destination)", async () => {
    const { cookie } = await makeUser(db);
    const a = await createAccount(cookie, { name: "A", type: "cash", currency: "LAK", openingBalance: 0 });
    const r1 = await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "transfer", amount: 1, currency: "LAK", fromAccountId: a.id, toAccountId: a.id, date: today } }), noParams);
    expect(r1.status).toBe(400);
    const r2 = await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "expense", amount: 1, currency: "LAK", fromAccountId: a.id, toAccountId: a.id, date: today } }), noParams);
    expect(r2.status).toBe(400);
  });
});

describe("Test 4 — dashboard period switch uses database records", () => {
  it("month vs year totals differ according to stored transactions", async () => {
    const { cookie } = await makeUser(db);
    const bank = await createAccount(cookie, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 1_000_000, openingDate: `${today.slice(0, 4)}-01-01` });
    const earlier = startOfMonth(today) > `${today.slice(0, 4)}-01-01` ? addDays(startOfMonth(today), -1) : null;
    await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "income", amount: 3_000_000, currency: "LAK", toAccountId: bank.id, date: today } }), noParams);
    if (earlier) await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "expense", amount: 200_000, currency: "LAK", fromAccountId: bank.id, date: earlier } }), noParams);
    const month = await dashboard(cookie, "month");
    const year = await dashboard(cookie, "year");
    expect(month.totals.income).toBe(3_000_000);
    expect(month.totals.expense).toBe(0);
    expect(year.totals.income).toBe(3_000_000);
    expect(year.totals.expense).toBe(earlier ? 200_000 : 0);
    expect(year.range.start).toBe(`${today.slice(0, 4)}-01-01`);
    expect(month.series.length).toBeGreaterThan(0);
    expect(year.series.length).toBeGreaterThan(0);
    // Changing back yields the same month result (no cached/fake data).
    expect((await dashboard(cookie, "month")).totals).toEqual(month.totals);
  });
});

describe("Test 5 — receipt scan requires explicit confirmation", () => {
  it("extracts an editable draft and only saves after confirmation", async () => {
    const { user, cookie } = await makeUser(db);
    const bank = await createAccount(cookie, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 1_000_000 });
    // Minimal valid PNG (1x1)
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const fd = new FormData();
    fd.set("file", new Blob([png], { type: "image/png" }), "r.png");
    fd.set("mode", "receipt");
    const up = await ReceiptsRoute.POST(new Request("http://localhost/api/receipts", { method: "POST", headers: { cookie, host: "localhost" }, body: fd }), noParams);
    expect(up.status).toBe(200);
    const { id } = await up.json();

    const fake: Extractor = {
      async receipt() {
        return {
          readable: true, documentType: "restaurant_bill", merchant: "Khao Piak Shop", date: today, time: "12:30", total: "85000", currency: "LAK", tax: null,
          items: [{ name: "Khao piak", quantity: "2", amount: "70000" }], paymentMethod: "cash", reference: "A-123", suggestedCategory: "food",
          confidence: { merchant: 0.95, date: 0.9, total: 0.6, currency: 0.99 }, uncertainty: "Total partially blurred",
        };
      },
      async banknote() { throw new Error("unused"); },
    };
    const ex = await extractReceipt(db, user.id, id, fake);
    expect(ex.mode).toBe("receipt");
    expect(ex.draft!.amount).toBe(85_000);
    expect(ex.draft!.uncertain).toContain("amount"); // low confidence is highlighted

    // Nothing recorded yet.
    let list = await json(await TxRoute.GET(req("/api/transactions", cookie), noParams));
    expect(list.body.total).toBe(0);
    expect(await balanceOf(cookie, bank.id)).toBe(1_000_000);

    // User confirms (possibly after editing) -> saved.
    const save = await json(await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: {
      type: "expense", amount: ex.draft!.amount, currency: "LAK", fromAccountId: bank.id, date: today, merchant: ex.draft!.merchant, categoryId: ex.draft!.categoryId, receiptId: id,
    } }), noParams));
    expect(save.status).toBe(200);
    list = await json(await TxRoute.GET(req("/api/transactions", cookie), noParams));
    expect(list.body.total).toBe(1);
    expect(await balanceOf(cookie, bank.id)).toBe(915_000);

    // A second scan of a receipt with the same total/date is flagged as a possible duplicate.
    const again = await extractReceipt(db, user.id, id, fake);
    expect(again.draft!.duplicates.length).toBe(1);
  });

  it("rejects non-image uploads", async () => {
    const { cookie } = await makeUser(db);
    const fd = new FormData();
    fd.set("file", new Blob([Buffer.from("<script>alert(1)</script>")], { type: "image/png" }), "x.png");
    const r = await ReceiptsRoute.POST(new Request("http://localhost/api/receipts", { method: "POST", headers: { cookie, host: "localhost" }, body: fd }), noParams);
    expect(r.status).toBe(415);
  });
});

describe("Test 6 — Google Sheets sync is idempotent", () => {
  it("repeated syncs never duplicate rows", async () => {
    const { user, cookie } = await makeUser(db);
    const bank = await createAccount(cookie, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 1_000_000 });
    await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "expense", amount: 50_000, currency: "LAK", fromAccountId: bank.id, date: today, description: "Coffee" } }), noParams);
    const { schema } = await import("@/server/db");
    await db.insert(schema.integrations).values({ userId: user.id, provider: "google_sheets" });

    // In-memory fake of the Sheets API with the same replace semantics.
    const sheets = new Map<string, (string | number)[][]>();
    const fake: SheetsApi = {
      async createSpreadsheet() { return "sheet-1"; },
      async ensureSheets() {},
      async replaceAll(_id, data) {
        for (const [k, v] of Object.entries(data)) sheets.set(k, v.map((r) => [...r]));
        return Object.values(data).reduce((s, v) => s + v.length - 1, 0);
      },
    };
    const j1 = await syncUser(db, user.id, "manual", fake);
    expect(j1.status).toBe("success");
    const txRows1 = sheets.get("Transactions")!;
    expect(txRows1.length).toBe(2); // header + 1 confirmed transaction
    await syncUser(db, user.id, "manual", fake);
    await syncUser(db, user.id, "auto", fake);
    const txRows3 = sheets.get("Transactions")!;
    expect(txRows3.length).toBe(2);
    expect(txRows3[1][0]).toBe(txRows1[1][0]); // stable record ID
    const ids = txRows3.slice(1).map((r) => r[0]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sheets.get("Accounts")!.length).toBe(2);
    expect([...sheets.keys()]).toEqual(expect.arrayContaining(["Accounts", "Transactions", "Categories", "Budgets", "Daily Summary", "Weekly Summary", "Monthly Summary", "Yearly Summary", "Balance Snapshots", "Settings"]));
  });
});

describe("Test 7 — multilingual UI", () => {
  it("every key is translated in English, Lao, Thai and Vietnamese", () => {
    const keys = Object.keys(DICTS.en);
    for (const l of LANGUAGES) {
      const d = DICTS[l] as Record<string, string>;
      for (const k of keys) {
        expect(d[k], `${l}:${k}`).toBeTruthy();
        // Placeholders must be preserved in every translation.
        const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
        expect(ph(d[k]), `${l}:${k} placeholders`).toBe(ph(DICTS.en[k as keyof typeof DICTS.en]));
      }
    }
  });

  it("navigation, notifications and summaries change with the language", async () => {
    expect(new Set(LANGUAGES.map((l) => translate(l, "nav.dashboard"))).size).toBe(4);
    expect(new Set(LANGUAGES.map((l) => translate(l, "tx.add"))).size).toBe(4);
    const vars = { expense: "250,000 LAK", income: "500,000 LAK", net: "+250,000 LAK", top: "Food", count: 3 };
    const titles = LANGUAGES.map((l) => renderNotification("daily_summary", vars, l));
    expect(new Set(titles.map((x) => x.title)).size).toBe(4);
    for (const n of titles) expect(n.body).toContain("250,000 LAK");
    expect(titles[0].body).toBe("Today's expenses: 250,000 LAK. Today's income: 500,000 LAK. Net cash flow: +250,000 LAK. Top category: Food. You have 3 transactions to review.");

    const { user, cookie } = await makeUser(db, { language: "th" });
    const a = await createAccount(cookie, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 100_000 });
    await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "expense", amount: 40_000, currency: "LAK", fromAccountId: a.id, date: today } }), noParams);
    const s = await buildSummary(db, user.id, "daily", today);
    const texts = LANGUAGES.map((l) => summaryNarrative(s, l));
    expect(new Set(texts).size).toBe(4);
    expect(texts[0]).toContain("40,000");
  });
});

describe("Test 8 — chatbot answers from authorized records", () => {
  it("'How much did I spend this month?' equals the stored expense total", async () => {
    const { user, cookie } = await makeUser(db);
    const a = await createAccount(cookie, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 10_000_000 });
    for (const amt of [120_000, 35_000, 845_000]) {
      await TxRoute.POST(req("/api/transactions", cookie, { method: "POST", body: { type: "expense", amount: amt, currency: "LAK", fromAccountId: a.id, date: today } }), noParams);
    }
    // Another user's spending must not leak in.
    const other = await makeUser(db);
    const b = await createAccount(other.cookie, { name: "X", type: "bank", currency: "LAK", openingBalance: 9_000_000 });
    await TxRoute.POST(req("/api/transactions", other.cookie, { method: "POST", body: { type: "expense", amount: 777_000, currency: "LAK", fromAccountId: b.id, date: today } }), noParams);

    const r = await json(await ChatRoute.POST(req("/api/chat", cookie, { method: "POST", body: { message: "How much did I spend this month?" } }), noParams));
    expect(r.status).toBe(200);
    const summary = r.body.ui.find((b: { type: string }) => b.type === "summary");
    expect(summary.expense).toBe(1_000_000);
    expect(r.body.message).toContain("1,000,000 LAK");
    expect(r.body.message).not.toContain("777,000");

    // Multilingual intents
    for (const q of ["ເດືອນນີ້ຂ້ອຍໃຊ້ຈ່າຍເທົ່າໃດ", "เดือนนี้ฉันใช้จ่ายเท่าไหร่", "Tháng này tôi đã chi tiêu bao nhiêu?"]) {
      const x = await chat(db, user.id, q, undefined, { forceRules: true });
      expect(x.ui.find((b) => b.type === "summary")).toMatchObject({ expense: 1_000_000 });
    }
    // Action requests open a prefilled form and never save on their own.
    const add = await chat(db, user.id, "Add an expense of 50,000 LAK for lunch", undefined, { forceRules: true });
    const action = add.ui.find((b) => b.type === "action");
    expect(action).toMatchObject({ action: "add_transaction", prefill: { amount: 50_000, currency: "LAK", type: "expense" } });
    const list = await json(await TxRoute.GET(req("/api/transactions", cookie), noParams));
    expect(list.body.total).toBe(3);
  });
});

describe("Test 9 — user data isolation", () => {
  it("a user cannot read, change or delete another user's records", async () => {
    const alice = await makeUser(db);
    const bob = await makeUser(db);
    const acc = await createAccount(alice.cookie, { name: "Alice bank", type: "bank", currency: "LAK", openingBalance: 1_000_000 });
    const tx = await json(await TxRoute.POST(req("/api/transactions", alice.cookie, { method: "POST", body: { type: "expense", amount: 10_000, currency: "LAK", fromAccountId: acc.id, date: today } }), noParams));
    const p = params({ id: acc.id });
    expect((await AccountRoute.GET(req(`/api/accounts/${acc.id}`, bob.cookie), p)).status).toBe(404);
    expect((await AccountRoute.PATCH(req(`/api/accounts/${acc.id}`, bob.cookie, { method: "PATCH", body: { name: "pwned" } }), p)).status).toBe(404);
    expect((await AccountRoute.DELETE(req(`/api/accounts/${acc.id}`, bob.cookie, { method: "DELETE" }), p)).status).toBe(404);
    const tp = params({ id: tx.body.id });
    expect((await TxItemRoute.GET(req(`/api/transactions/${tx.body.id}`, bob.cookie), tp)).status).toBe(404);
    expect((await TxItemRoute.PATCH(req(`/api/transactions/${tx.body.id}`, bob.cookie, { method: "PATCH", body: { amount: 1 } }), tp)).status).toBe(404);
    expect((await TxItemRoute.DELETE(req(`/api/transactions/${tx.body.id}`, bob.cookie, { method: "DELETE" }), tp)).status).toBe(404);
    // Bob cannot post a transaction into Alice's account.
    const steal = await TxRoute.POST(req("/api/transactions", bob.cookie, { method: "POST", body: { type: "expense", amount: 1, currency: "LAK", fromAccountId: acc.id, date: today } }), noParams);
    expect(steal.status).toBe(400);
    // Lists only contain own data.
    const bobList = await json(await AccountsRoute.GET(req("/api/accounts", bob.cookie), noParams));
    expect(bobList.body).toEqual([]);
    // Unauthenticated and forged cookies are rejected.
    expect((await AccountsRoute.GET(req("/api/accounts", ""), noParams)).status).toBe(401);
    expect((await AccountsRoute.GET(req("/api/accounts", "mp_session=forged"), noParams)).status).toBe(401);
    // Alice's data unchanged.
    expect(await balanceOf(alice.cookie, acc.id)).toBe(990_000);
  });

  it("rejects cross-site POSTs", async () => {
    const { cookie } = await makeUser(db);
    const r = await AccountsRoute.POST(new Request("http://localhost/api/accounts", {
      method: "POST", headers: { cookie, host: "localhost", origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ name: "x", type: "cash", currency: "LAK", openingBalance: 0 }),
    }), noParams);
    expect(r.status).toBe(403);
  });
});

describe("Test 10 — persistence across logout/login", () => {
  it("confirmed data is still there after logging out and back in", async () => {
    const email = `persist-${Date.now()}@example.com`;
    const password = "a strong password";
    const reg = await RegisterRoute.POST(new Request("http://localhost/api/auth/register", { method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ email, password, name: "P" }) }), noParams);
    expect(reg.status).toBe(200);
    const cookie1 = reg.headers.get("set-cookie")!.split(";")[0];
    const acc = await createAccount(cookie1, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 2_000_000 });
    await TxRoute.POST(req("/api/transactions", cookie1, { method: "POST", body: { type: "expense", amount: 300_000, currency: "LAK", fromAccountId: acc.id, date: today } }), noParams);

    const out = await LogoutRoute.POST(req("/api/auth/logout", cookie1, { method: "POST", body: {} }), noParams);
    expect(out.status).toBe(200);
    expect((await MeRoute.GET(req("/api/me", cookie1), noParams)).status).toBe(401); // old session invalid

    const bad = await LoginRoute.POST(new Request("http://localhost/api/auth/login", { method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ email, password: "wrong password" }) }), noParams);
    expect(bad.status).toBe(401);
    const login = await LoginRoute.POST(new Request("http://localhost/api/auth/login", { method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), noParams);
    expect(login.status).toBe(200);
    const cookie2 = login.headers.get("set-cookie")!.split(";")[0];
    const me = await json(await MeRoute.GET(req("/api/me", cookie2), noParams));
    expect(me.body.accounts).toHaveLength(1);
    expect(me.body.accounts[0].balance).toBe(1_700_000);
    const list = await json(await TxRoute.GET(req("/api/transactions", cookie2), noParams));
    expect(list.body.total).toBe(1);
  });
});
