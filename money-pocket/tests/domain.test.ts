import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb, makeUser } from "./helpers";
import { schema, type DB } from "@/server/db";
import { convertMinor, formatMoney, invertRate, parseAmount, pctChange, toDecimalString } from "@/lib/money";
import { addDays, rangeFor, todayIn, zonedToUtc, localDateOf } from "@/lib/dates";
import { createAccount, listAccounts, reconcileAccount } from "@/server/services/accounts";
import { createTransaction, deleteTransaction, restoreTransaction, updateTransaction } from "@/server/services/transactions";
import { dashboard } from "@/server/services/reports";
import { createHolding, listHoldings } from "@/server/services/goals";
import { createRecurring, postRecurring, listRecurring, nextOccurrence } from "@/server/services/recurring";
import { createBudget } from "@/server/services/budgets";
import { tickUser } from "@/server/services/scheduler";
import { parseIntent, parseMoneyText } from "@/server/services/chat-rules";

let db: DB;
const today = todayIn("Asia/Vientiane");
beforeAll(async () => { db = await freshDb(); });

describe("money", () => {
  it("parses and formats exact minor units", () => {
    expect(parseAmount("5,000,000", "LAK")).toBe(5_000_000);
    expect(parseAmount("12.50", "USD")).toBe(1250);
    expect(parseAmount("12.505", "USD")).toBeNull(); // no silent rounding
    expect(parseAmount("12.500", "USD")).toBe(1250);
    expect(parseAmount("abc", "LAK")).toBeNull();
    expect(toDecimalString(1250, "USD")).toBe("12.50");
    expect(toDecimalString(-5, "THB")).toBe("-0.05");
    expect(formatMoney(5_000_000, "LAK", "en")).toBe("5,000,000 LAK");
    expect(formatMoney(-1250, "USD", "en")).toBe("−12.50 USD");
    expect(formatMoney(250_000, "LAK", "en", { sign: true })).toBe("+250,000 LAK");
  });
  it("converts with exact rational arithmetic", () => {
    expect(convertMinor(1000, "USD", "LAK", "21500")).toBe(215_000); // $10
    expect(convertMinor(1, "USD", "LAK", "21500")).toBe(215); // 1 cent
    expect(convertMinor(100_000, "LAK", "THB", "0.0016667")).toBe(16667); // 166.67 THB
    expect(invertRate("21500")).toBe("0.000046511628");
    expect(convertMinor(0.1 * 3 === 0.3 ? 1 : 3, "USD", "USD", "1")).toBe(3);
  });
  it("only reports % change with a meaningful baseline", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(100, 0)).toBeNull();
  });
});

describe("dates", () => {
  it("handles periods and time zones", () => {
    expect(rangeFor("week", "2026-10-09")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(rangeFor("month", "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    const utc = zonedToUtc("2026-10-09", "21:30", "Asia/Vientiane");
    expect(utc.toISOString()).toBe("2026-10-09T14:30:00.000Z");
    expect(localDateOf(new Date("2026-10-09T18:00:00Z"), "Asia/Vientiane")).toBe("2026-10-10");
    expect(nextOccurrence("2026-01-31", "monthly", "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence("2026-02-28", "monthly", "2026-01-31")).toBe("2026-03-31");
  });
});

describe("multi-currency", () => {
  it("stores original and converted values, and never rewrites history when rates change", async () => {
    const { user } = await makeUser(db);
    const usd = await createAccount(db, user.id, { name: "USD cash", type: "cash", currency: "USD", openingBalance: 10_000 });
    const lak = await createAccount(db, user.id, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 0 });
    await expect(createTransaction(db, user.id, { type: "expense", amount: 500, currency: "USD", fromAccountId: usd.id, date: today })).rejects.toMatchObject({ code: "rate_missing" });
    await db.insert(schema.exchangeRates).values({ userId: user.id, base: "USD", quote: "LAK", rate: "21500", effectiveDate: addDays(today, -30) });
    const t1 = await createTransaction(db, user.id, { type: "expense", amount: 500, currency: "USD", fromAccountId: usd.id, date: today });
    expect(t1.amount).toBe(500);
    expect(t1.currency).toBe("USD");
    expect(t1.reportingAmount).toBe(107_500);
    // Cross-currency transfer: $20 -> LAK account at the configured rate.
    const t2 = await createTransaction(db, user.id, { type: "transfer", amount: 2000, currency: "USD", fromAccountId: usd.id, toAccountId: lak.id, date: today });
    expect(t2.fromAmount).toBe(2000);
    expect(t2.toAmount).toBe(430_000);
    // New rate later — stored values unchanged.
    await db.insert(schema.exchangeRates).values({ userId: user.id, base: "USD", quote: "LAK", rate: "22000", effectiveDate: today });
    const [again] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, t1.id));
    expect(again.reportingAmount).toBe(107_500);
    // Editing a non-money field keeps the original reporting snapshot.
    const edited = await updateTransaction(db, user.id, t1.id, { description: "Taxi" });
    expect(edited.reportingAmount).toBe(107_500);
    const accs = await listAccounts(db, user.id);
    expect(accs.find((a) => a.id === usd.id)!.balance).toBe(10_000 - 500 - 2000);
    expect(accs.find((a) => a.id === lak.id)!.balance).toBe(430_000);
  });
});

describe("investments", () => {
  it("purchases are transfers (not gains); sales realize gain vs cost basis", async () => {
    const { user } = await makeUser(db);
    const bank = await createAccount(db, user.id, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 10_000_000 });
    const inv = await createAccount(db, user.id, { name: "Broker", type: "investment", currency: "LAK", openingBalance: 0 });
    const h = await createHolding(db, user.id, { accountId: inv.id, name: "Fund", assetType: "fund" });
    await createTransaction(db, user.id, { type: "investment_purchase", amount: 1_000_000, currency: "LAK", fromAccountId: bank.id, toAccountId: inv.id, holdingId: h.id, units: "100", date: today });
    let d = await dashboard(db, user.id, { period: "month", today });
    expect(d.totals.income).toBe(0);
    expect(d.totals.expense).toBe(0);
    expect(d.overview.netWorth).toBe(10_000_000);
    // Sell half for 600,000: cost portion 500,000, realized gain 100,000.
    const sale = await createTransaction(db, user.id, { type: "investment_sale", amount: 600_000, currency: "LAK", fromAccountId: inv.id, toAccountId: bank.id, holdingId: h.id, units: "50", date: today });
    let [hh] = await listHoldings(db, user.id);
    expect(hh.units).toBe("50");
    expect(hh.costBasis).toBe(500_000);
    expect(hh.realized).toBe(100_000);
    d = await dashboard(db, user.id, { period: "month", today });
    expect(d.totals.income).toBe(0); // realized gain is reported separately
    expect(d.totals.realizedGains).toBe(100_000);
    expect(d.overview.netWorth).toBe(10_100_000);
    const accs = await listAccounts(db, user.id);
    expect(accs.find((a) => a.id === inv.id)!.balance).toBe(500_000); // = remaining cost basis
    // Undo the sale restores the holding.
    await deleteTransaction(db, user.id, sale.id);
    [hh] = await listHoldings(db, user.id);
    expect(hh.units).toBe("100");
    expect(hh.costBasis).toBe(1_000_000);
    await restoreTransaction(db, user.id, sale.id);
    [hh] = await listHoldings(db, user.id);
    expect(hh.units).toBe("50");
  });
});

describe("reconciliation", () => {
  it("records differences as adjustments, never income", async () => {
    const { user } = await makeUser(db);
    const a = await createAccount(db, user.id, { name: "Wallet", type: "cash", currency: "LAK", openingBalance: 500_000 });
    const s = await reconcileAccount(db, user.id, a.id, { actualBalance: 650_000 });
    expect(s.difference).toBe(150_000);
    const d = await dashboard(db, user.id, { period: "month", today });
    expect(d.totals.income).toBe(0);
    expect(d.totals.adjustments).toBe(150_000);
    expect((await listAccounts(db, user.id))[0].balance).toBe(650_000);
  });
});

describe("recurring", () => {
  it("is not posted until the posting rule is satisfied", async () => {
    const { user } = await makeUser(db);
    const a = await createAccount(db, user.id, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 5_000_000, openingDate: addDays(today, -10) });
    const r = await createRecurring(db, user.id, { name: "Rent", type: "expense", amount: 2_000_000, currency: "LAK", fromAccountId: a.id, frequency: "monthly", startDate: addDays(today, -1), reminderDaysBefore: 3, autoPost: false });
    let [x] = await listRecurring(db, user.id);
    expect(x.status).toBe("overdue");
    expect((await listAccounts(db, user.id))[0].balance).toBe(5_000_000);
    await postRecurring(db, user.id, r.id);
    [x] = await listRecurring(db, user.id);
    expect(x.status).not.toBe("overdue");
    expect((await listAccounts(db, user.id))[0].balance).toBe(3_000_000);
  });
});

describe("notifications & scheduler", () => {
  it("budget alerts fire once per threshold window; daily summary only after reminder time and deduplicated", async () => {
    const { user } = await makeUser(db);
    const a = await createAccount(db, user.id, { name: "Bank", type: "bank", currency: "LAK", openingBalance: 5_000_000 });
    await createBudget(db, user.id, { period: "monthly", amount: 1_000_000 });
    await createTransaction(db, user.id, { type: "expense", amount: 850_000, currency: "LAK", fromAccountId: a.id, date: today });
    let n = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(n.map((x) => x.kind)).toEqual(["budget_threshold"]);
    expect(n[0].title).toContain("80%");
    await createTransaction(db, user.id, { type: "expense", amount: 10_000, currency: "LAK", fromAccountId: a.id, date: today });
    n = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(n.length).toBe(1); // still 86% — no duplicate
    await createTransaction(db, user.id, { type: "expense", amount: 200_000, currency: "LAK", fromAccountId: a.id, date: today });
    n = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(n.length).toBe(2); // crossed 100%

    // Before reminder time (21:30 Vientiane = 14:30 UTC): no daily summary.
    const before = zonedToUtc(today, "20:00", "Asia/Vientiane");
    await tickUser(db, user.id, before);
    n = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(n.some((x) => x.kind === "daily_summary")).toBe(false);
    const after = zonedToUtc(today, "21:31", "Asia/Vientiane");
    await tickUser(db, user.id, after);
    await tickUser(db, user.id, after);
    n = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    const daily = n.filter((x) => x.kind === "daily_summary");
    expect(daily.length).toBe(1);
    expect(daily[0].body).toContain("Today's expenses: 1,060,000 LAK");
    expect(daily[0].pushStatus === null || daily[0].pushStatus === "not_configured").toBe(true);
  });
});

describe("chat intent parser", () => {
  it("understands amounts and intents in 4 languages", () => {
    expect(parseMoneyText("add 50,000 LAK for lunch")).toEqual({ amount: "50000", currency: "LAK" });
    expect(parseMoneyText("50k kip")).toEqual({ amount: "50000", currency: "LAK" });
    expect(parseMoneyText("thêm 50.000đ ăn trưa")).toEqual({ amount: "50000", currency: "VND" });
    expect(parseMoneyText("2 ล้าน บาท")?.amount).toBe("2000000");
    expect(parseIntent("Find transactions above 500,000 LAK", today)).toMatchObject({ tool: "find_transactions", input: { min_amount: "500000" } });
    expect(parseIntent("Compare this month with last month", today)).toMatchObject({ tool: "compare_periods" });
    expect(parseIntent("Where did most of my money go this month?", today)).toMatchObject({ tool: "get_spending_by_category" });
    expect(parseIntent("Create a new emergency account", today)).toMatchObject({ tool: "prepare_account", input: { name: "Emergency" } });
    expect(parseIntent("Create a monthly budget for food", today)).toMatchObject({ tool: "prepare_budget", input: { category_key: "food", period: "monthly" } });
    expect(parseIntent("Summarize my finances for September", "2026-10-09")).toMatchObject({ tool: "get_period_summary", input: { period: "month", anchor_date: "2026-09-01" } });
    expect(parseIntent("Scan this receipt and prepare a transaction", today)).toMatchObject({ tool: "open_scanner" });
    expect(parseIntent("Show my total available balance", today)).toMatchObject({ tool: "get_balances" });
    expect(parseIntent("Show my savings progress", today)).toMatchObject({ tool: "get_savings_progress" });
    expect(parseIntent("ມື້ນີ້ຂ້ອຍໃຊ້ເງິນໄປເທົ່າໃດ", today)).toMatchObject({ tool: "get_period_summary", input: { period: "day" } });
    expect(parseIntent("เพิ่มรายจ่าย 50,000 กีบ ค่าอาหาร", today)).toMatchObject({ tool: "prepare_transaction", input: { amount: "50000", currency: "LAK", category_key: "food" } });
    expect(parseIntent("So sánh tháng này với tháng trước", today)).toMatchObject({ tool: "compare_periods" });
  });
});
