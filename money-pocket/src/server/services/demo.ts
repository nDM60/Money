import { eq } from "drizzle-orm";
import { schema } from "../db";
import { addDays, startOfMonth } from "@/lib/dates";
import type { Exec } from "./common";
import { createAccount } from "./accounts";
import { createTransaction } from "./transactions";
import { createBudget } from "./budgets";
import { createGoal, createHolding, updateHolding } from "./goals";
import { createRecurring } from "./recurring";
import { userToday } from "./settings";

/**
 * Populate a *demo* user (users.is_demo = true) with realistic sample data.
 * Demo data never mixes with real users' records: it lives in its own account.
 */
export async function seedDemo(db: Exec, userId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u?.isDemo) throw new Error("seedDemo is only allowed for demo users");
  const today = await userToday(userId, db);
  const start = addDays(today, -95);
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const round = (v: number, step = 1000) => Math.max(step, Math.round(v / step) * step);

  await db.insert(schema.exchangeRates).values([
    { userId, base: "USD", quote: "LAK", rate: "21500", effectiveDate: start },
    { userId, base: "THB", quote: "LAK", rate: "600", effectiveDate: start },
  ]);

  const mk = (name: string, type: "cash" | "bank" | "savings" | "investment" | "ewallet", openingBalance: number, color: string, institution?: string, currency = "LAK") =>
    createAccount(db, userId, { name, type, currency, openingBalance, openingDate: start, color, institution });
  const daily = await mk("Daily Expenses", "bank", 20_000_000, "#0f766e", "BCEL");
  const bank = await mk("Bank Account", "bank", 5_000_000, "#1d4ed8", "LDB");
  const savings = await mk("Savings", "savings", 10_000_000, "#2563eb", "LDB");
  const emergency = await mk("Emergency Fund", "savings", 3_000_000, "#0891b2");
  const invest = await mk("Investment", "investment", 2_000_000, "#7c3aed", "LSX broker");
  const cash = await mk("Cash Wallet", "cash", 2_000_000, "#ca8a04");
  const usd = await mk("USD Travel", "cash", 30_000, "#475569", undefined, "USD");

  const cats = await db.select().from(schema.categories).where(eq(schema.categories.userId, userId));
  const cat = (k: string) => cats.find((c) => c.systemKey === k)!.id;

  const holding = await createHolding(db, userId, { accountId: invest.id, name: "LSX Index Fund", symbol: "LSXI", assetType: "fund" });

  const expenses: [string, string, number, number][] = [
    ["food", "Lunch", 35_000, 90_000], ["food", "Coffee", 15_000, 35_000], ["groceries", "Market", 80_000, 350_000],
    ["transport", "Grab ride", 20_000, 60_000], ["fuel", "Fuel", 100_000, 250_000], ["entertainment", "Beer with friends", 100_000, 400_000],
    ["shopping", "Clothes", 150_000, 600_000], ["personal_care", "Haircut", 40_000, 80_000], ["healthcare", "Pharmacy", 30_000, 150_000],
  ];
  const merchants: Record<string, string[]> = {
    food: ["Khao Piak Shop", "Joma Bakery", "Noodle House", "Sinouk Coffee"], groceries: ["Morning Market", "Rimping Supermarket"],
    transport: ["LOCA", "Grab"], fuel: ["PTT Station", "Plus Fuel"], entertainment: ["Chokdee Bar", "Major Cineplex"],
    shopping: ["Vientiane Center", "ITECC Mall"], personal_care: ["Barber 99"], healthcare: ["Pharmacy 24"],
  };

  for (let d = start; d <= today; d = addDays(d, 1)) {
    const dom = +d.slice(8, 10);
    if (dom === 25) await createTransaction(db, userId, { type: "income", amount: 12_000_000, currency: "LAK", toAccountId: bank.id, date: d, categoryId: cat("salary"), description: "Monthly salary", merchant: "Employer Co.", paymentMethod: "bank_transfer" }, { skipAlerts: true });
    if (dom === 3 || dom === 18) await createTransaction(db, userId, { type: "transfer", amount: 1_500_000, currency: "LAK", fromAccountId: bank.id, toAccountId: cash.id, date: d, description: "ATM withdrawal" }, { skipAlerts: true });
    if (dom === 26) await createTransaction(db, userId, { type: "transfer", amount: 4_000_000, currency: "LAK", fromAccountId: bank.id, toAccountId: daily.id, date: d, description: "Monthly spending money" }, { skipAlerts: true });
    if (dom === 27) await createTransaction(db, userId, { type: "savings_contribution", amount: 2_000_000, currency: "LAK", fromAccountId: bank.id, toAccountId: savings.id, date: d, description: "Monthly savings" }, { skipAlerts: true });
    if (dom === 28) await createTransaction(db, userId, { type: "investment_purchase", amount: 1_000_000, currency: "LAK", fromAccountId: bank.id, toAccountId: invest.id, date: d, holdingId: holding.id, units: "95.5", description: "Index fund purchase" }, { skipAlerts: true });
    if (dom === 1) await createTransaction(db, userId, { type: "expense", amount: 2_500_000, currency: "LAK", fromAccountId: bank.id, date: d, categoryId: cat("housing"), description: "Apartment rent", paymentMethod: "bank_transfer" }, { skipAlerts: true });
    if (dom === 5) await createTransaction(db, userId, { type: "expense", amount: round(350_000 + rnd() * 150_000), currency: "LAK", fromAccountId: bank.id, date: d, categoryId: cat("utilities"), description: "Electricity (EDL)", paymentMethod: "qr" }, { skipAlerts: true });
    if (dom === 6) await createTransaction(db, userId, { type: "expense", amount: 299_000, currency: "LAK", fromAccountId: bank.id, date: d, categoryId: cat("utilities"), description: "Internet (Unitel)", paymentMethod: "qr" }, { skipAlerts: true });
    if (dom === 10) await createTransaction(db, userId, { type: "expense", amount: 450_000, currency: "LAK", fromAccountId: daily.id, date: d, categoryId: cat("fitness"), description: "Gym membership", paymentMethod: "card" }, { skipAlerts: true });
    if (dom === 15) await createTransaction(db, userId, { type: "income", amount: round(1_500_000 + rnd() * 2_000_000, 100_000), currency: "LAK", toAccountId: bank.id, date: d, categoryId: cat("freelance"), description: "Design project", merchant: "Client" }, { skipAlerts: true });
    const n = Math.floor(rnd() * 3) + 1;
    for (let i = 0; i < n; i++) {
      const [k, desc, lo, hi] = pick(expenses);
      if ((k === "shopping" || k === "entertainment") && rnd() < 0.6) continue;
      await createTransaction(db, userId, {
        type: "expense", amount: round(lo + rnd() * (hi - lo)), currency: "LAK", fromAccountId: rnd() < 0.75 ? daily.id : cash.id,
        date: d, time: `${String(8 + Math.floor(rnd() * 13)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}`,
        categoryId: cat(k), description: desc, merchant: pick(merchants[k] ?? ["Shop"]), paymentMethod: pick(["cash", "qr", "card"]),
      }, { skipAlerts: true });
    }
  }
  await createTransaction(db, userId, { type: "expense", amount: 4_500, currency: "USD", fromAccountId: usd.id, date: addDays(today, -40), categoryId: cat("travel"), description: "Hotel in Bangkok", merchant: "Hotel", paymentMethod: "card" }, { skipAlerts: true });
  await createTransaction(db, userId, { type: "income", amount: 120_000, currency: "LAK", toAccountId: invest.id, date: addDays(today, -20), categoryId: cat("dividends"), description: "Fund distribution", holdingId: holding.id }, { skipAlerts: true });
  await updateHolding(db, userId, holding.id, { marketValue: 3_450_000, valuedAt: addDays(today, -3) });

  await createBudget(db, userId, { period: "monthly", amount: 9_000_000, startDate: startOfMonth(start) });
  await createBudget(db, userId, { period: "monthly", categoryId: cat("food"), amount: 1_500_000, startDate: startOfMonth(start) });
  await createBudget(db, userId, { period: "monthly", categoryId: cat("entertainment"), amount: 600_000, startDate: startOfMonth(start) });
  await createBudget(db, userId, { period: "weekly", categoryId: cat("groceries"), amount: 800_000, startDate: startOfMonth(start) });

  await createGoal(db, userId, { name: "Emergency Fund", targetAmount: 15_000_000, currency: "LAK", accountId: emergency.id, targetDate: addDays(today, 300) });
  await createGoal(db, userId, { name: "Trip to Japan", targetAmount: 25_000_000, currency: "LAK", accountId: savings.id, targetDate: addDays(today, 200) });

  await createRecurring(db, userId, { name: "Apartment rent", type: "expense", amount: 2_500_000, currency: "LAK", fromAccountId: bank.id, categoryId: cat("housing"), frequency: "monthly", startDate: addDays(startOfMonth(today), 31).slice(0, 8) + "01", reminderDaysBefore: 3, autoPost: false });
  await createRecurring(db, userId, { name: "Internet (Unitel)", type: "expense", amount: 299_000, currency: "LAK", fromAccountId: bank.id, categoryId: cat("utilities"), frequency: "monthly", startDate: addDays(today, 2), reminderDaysBefore: 2, autoPost: false });
  await createRecurring(db, userId, { name: "Netflix", type: "expense", amount: 499, currency: "USD", fromAccountId: usd.id, categoryId: cat("subscriptions"), frequency: "monthly", startDate: addDays(today, -1), reminderDaysBefore: 1, autoPost: false });
  await createRecurring(db, userId, { name: "Monthly salary", type: "income", amount: 12_000_000, currency: "LAK", toAccountId: bank.id, categoryId: cat("salary"), frequency: "monthly", startDate: today.slice(0, 8) + "25" > today ? today.slice(0, 8) + "25" : addDays(startOfMonth(today), 40).slice(0, 8) + "25", reminderDaysBefore: 0, autoPost: false });

  await db.update(schema.userSettings).set({ onboarded: true }).where(eq(schema.userSettings.userId, userId));
}
