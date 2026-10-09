import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, encrypt } from "../crypto";
import { toDecimalString } from "@/lib/money";
import { addDays, addMonths, rangeFor, startOfMonth, startOfWeek, startOfYear } from "@/lib/dates";
import type { Exec } from "./common";
import { listAccounts, listSnapshots } from "./accounts";
import { listCategories, listBudgets } from "./budgets";
import { getSettings, userToday } from "./settings";
import { loadFlows, savingsAccountIds, seriesOf, totalsOf } from "./reports";

/**
 * Google Sheets is a reporting/export destination. The app database is the
 * source of truth: each sync rewrites every worksheet from the database, keyed
 * by stable record IDs, so repeating a sync never duplicates rows. Edits made
 * in the spreadsheet are overwritten on the next sync (one-way, app -> sheet).
 */

export const SHEET_NAMES = [
  "Accounts", "Transactions", "Categories", "Budgets", "Daily Summary", "Weekly Summary",
  "Monthly Summary", "Yearly Summary", "Balance Snapshots", "Settings",
] as const;

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface SheetsApi {
  createSpreadsheet(title: string, sheets: readonly string[]): Promise<string>;
  ensureSheets(spreadsheetId: string, sheets: readonly string[]): Promise<void>;
  replaceAll(spreadsheetId: string, data: Record<string, (string | number)[][]>): Promise<number>;
}

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL && process.env.APP_SECRET);
}

export function redirectUri() {
  return `${process.env.APP_URL!.replace(/\/$/, "")}/api/integrations/google/callback`;
}

export function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google token error: ${json.error ?? res.status}`);
  return json;
}

export async function connectWithCode(db: Exec, userId: string, code: string) {
  const tok = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  const values = {
    userId, provider: "google_sheets",
    accessTokenEnc: encrypt(tok.access_token!),
    refreshTokenEnc: tok.refresh_token ? encrypt(tok.refresh_token) : null,
    tokenExpiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
    scope: tok.scope ?? GOOGLE_SCOPE,
    dirty: true, lastError: null, failures: 0,
  };
  await db.insert(schema.integrations).values(values).onConflictDoUpdate({
    target: [schema.integrations.userId, schema.integrations.provider],
    set: { ...values, refreshTokenEnc: values.refreshTokenEnc ?? undefined },
  });
}

async function accessToken(db: Exec, integ: typeof schema.integrations.$inferSelect) {
  if (integ.accessTokenEnc && integ.tokenExpiresAt && integ.tokenExpiresAt.getTime() > Date.now() + 60000) {
    return decrypt(integ.accessTokenEnc);
  }
  if (!integ.refreshTokenEnc) throw new Error("Google authorization expired — reconnect Google Sheets");
  const tok = await tokenRequest({ refresh_token: decrypt(integ.refreshTokenEnc), grant_type: "refresh_token" });
  await db.update(schema.integrations).set({
    accessTokenEnc: encrypt(tok.access_token!),
    tokenExpiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
  }).where(and(eq(schema.integrations.userId, integ.userId), eq(schema.integrations.provider, integ.provider)));
  return tok.access_token!;
}

export function googleSheetsApi(token: string): SheetsApi {
  const base = "https://sheets.googleapis.com/v4/spreadsheets";
  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`Google Sheets API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<T>;
  }
  const q = (name: string) => `'${name.replace(/'/g, "''")}'`;
  return {
    async createSpreadsheet(title, sheets) {
      const r = await call<{ spreadsheetId: string }>(base, {
        method: "POST",
        body: JSON.stringify({ properties: { title }, sheets: sheets.map((s) => ({ properties: { title: s, gridProperties: { frozenRowCount: 1 } } })) }),
      });
      return r.spreadsheetId;
    },
    async ensureSheets(id, sheets) {
      const meta = await call<{ sheets: { properties: { title: string } }[] }>(`${base}/${id}?fields=sheets.properties.title`);
      const have = new Set(meta.sheets.map((s) => s.properties.title));
      const missing = sheets.filter((s) => !have.has(s));
      if (missing.length) {
        await call(`${base}/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: missing.map((s) => ({ addSheet: { properties: { title: s } } })) }) });
      }
    },
    async replaceAll(id, data) {
      const names = Object.keys(data);
      await call(`${base}/${id}/values:batchClear`, { method: "POST", body: JSON.stringify({ ranges: names.map(q) }) });
      await call(`${base}/${id}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data: names.map((n) => ({ range: `${q(n)}!A1`, values: data[n] })) }),
      });
      return names.reduce((s, n) => s + Math.max(0, data[n].length - 1), 0);
    },
  };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

/** Build the full worksheet contents from the database. Every row starts with a stable ID. */
export async function buildSheetData(db: Exec, userId: string): Promise<Record<string, (string | number)[][]>> {
  const settings = await getSettings(userId, db);
  const primary = settings.primaryCurrency;
  const today = await userToday(userId, db);
  const accounts = await listAccounts(db, userId, { includeArchived: true });
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const cats = await listCategories(db, userId);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const t = schema.transactions;
  const txs = await db.select().from(t).where(and(eq(t.userId, userId), isNull(t.deletedAt))).orderBy(asc(t.localDate), asc(t.createdAt));
  const budgets = await listBudgets(db, userId);
  const snaps = await listSnapshots(db, userId);
  const money = (v: number | null | undefined, c: string) => (v === null || v === undefined ? "" : toDecimalString(v, c));

  const out: Record<string, (string | number)[][]> = {};
  out["Accounts"] = [
    ["id", "name", "type", "institution", "currency", "opening_balance", "opening_date", "current_balance", "status", "created_at", "updated_at"],
    ...accounts.map((a) => [a.id, a.name, a.type, a.institution ?? "", a.currency, money(a.openingBalance, a.currency), a.openingDate, money(a.balance, a.currency), a.status, iso(a.createdAt), iso(a.updatedAt)]),
  ];
  out["Transactions"] = [
    ["id", "date", "type", "amount", "currency", "from_account", "to_account", "from_amount", "to_amount", "category", "description", "merchant", "payment_method", "tags", "notes", `reporting_amount_${primary}`, "fx_rate", "created_at", "updated_at"],
    ...txs.map((x) => {
      const fromCur = accounts.find((a) => a.id === x.fromAccountId)?.currency ?? x.currency;
      const toCur = accounts.find((a) => a.id === x.toAccountId)?.currency ?? x.currency;
      return [
        x.id, x.localDate, x.type, money(x.amount, x.currency), x.currency,
        x.fromAccountId ? accName.get(x.fromAccountId) ?? "" : "", x.toAccountId ? accName.get(x.toAccountId) ?? "" : "",
        money(x.fromAmount, fromCur), money(x.toAmount, toCur),
        x.categoryId ? catName.get(x.categoryId) ?? "" : "", x.description, x.merchant ?? "", x.paymentMethod ?? "", x.tags.join(", "), x.notes ?? "",
        money(x.reportingAmount, x.reportingCurrency), x.fxRate, iso(x.createdAt), iso(x.updatedAt),
      ];
    }),
  ];
  out["Categories"] = [
    ["id", "name", "kind", "parent", "color", "archived", "created_at"],
    ...cats.map((c) => [c.id, c.name, c.kind, c.parentId ? catName.get(c.parentId) ?? "" : "", c.color, c.archived ? "yes" : "no", iso(c.createdAt)]),
  ];
  out["Budgets"] = [
    ["id", "category", "period", "amount", "currency", "thresholds", "rollover", "start_date", "active"],
    ...budgets.map((b) => [b.id, b.categoryId ? catName.get(b.categoryId) ?? "" : "(overall)", b.period, money(b.amount, b.currency), b.currency, b.thresholds.join("/"), b.rollover ? "yes" : "no", b.startDate, b.active ? "yes" : "no"]),
  ];

  const savingsIds = await savingsAccountIds(db, userId);
  const all = await loadFlows(db, userId, { start: addMonths(startOfYear(today), -24), end: today });
  const summaryRows = (keys: { key: string; start: string; end: string }[]) => keys.map((k) => {
    const tot = totalsOf(all.flows.filter((f) => f.localDate >= k.start && f.localDate <= k.end), savingsIds);
    return [k.key, k.start, k.end, money(tot.income, primary), money(tot.expense, primary), money(tot.net, primary), money(tot.savingsContributions, primary), tot.count];
  });
  const head = ["id", "start", "end", `income_${primary}`, `expenses_${primary}`, `net_${primary}`, `savings_${primary}`, "transactions"];
  const days = seriesOf(all.flows, { start: addDays(today, -59), end: today }, "day").map((d) => ({ key: d.key, start: d.key, end: d.key }));
  out["Daily Summary"] = [head, ...summaryRows(days)];
  const weeks = Array.from({ length: 26 }, (_, i) => {
    const s = addDays(startOfWeek(today), -7 * (25 - i));
    return { key: `W${s}`, start: s, end: addDays(s, 6) };
  });
  out["Weekly Summary"] = [head, ...summaryRows(weeks)];
  const months = Array.from({ length: 24 }, (_, i) => {
    const s = addMonths(startOfMonth(today), -(23 - i));
    return { key: s.slice(0, 7), start: s, end: rangeFor("month", s).end };
  });
  out["Monthly Summary"] = [head, ...summaryRows(months)];
  const y = +today.slice(0, 4);
  out["Yearly Summary"] = [head, ...summaryRows([y - 2, y - 1, y].map((yy) => ({ key: String(yy), start: `${yy}-01-01`, end: `${yy}-12-31` })))];
  out["Balance Snapshots"] = [
    ["id", "account", "kind", "effective_date", "actual_balance", "calculated_balance", "difference", "note", "created_at"],
    ...snaps.map((s) => {
      const cur = accounts.find((a) => a.id === s.accountId)?.currency ?? primary;
      return [s.id, accName.get(s.accountId) ?? "", s.kind, s.effectiveDate, money(s.actualBalance, cur), money(s.calculatedBalance, cur), money(s.difference, cur), s.note ?? "", iso(s.createdAt)];
    }),
  ];
  out["Settings"] = [
    ["key", "value"],
    ["generated_by", "Money Pocket"],
    ["sync_rule", "One-way sync: the Money Pocket database is the source of truth. Edits made in this spreadsheet are overwritten on the next sync — make changes in the app."],
    ["primary_currency", primary],
    ["language", settings.language],
    ["timezone", settings.timezone],
    ["amount_format", "Plain decimal numbers in each row's currency"],
    ["last_sync", new Date().toISOString()],
  ];
  return out;
}

/** Run one sync for a user. Returns the sync job row. */
export async function syncUser(db: Exec, userId: string, trigger: "manual" | "auto", apiOverride?: SheetsApi) {
  const [integ] = await db.select().from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google_sheets")));
  if (!integ) throw new Error("Google Sheets is not connected");
  const [job] = await db.insert(schema.syncJobs).values({ userId, provider: "google_sheets", trigger, status: "running" }).returning();
  try {
    const api = apiOverride ?? googleSheetsApi(await accessToken(db, integ));
    let spreadsheetId = integ.spreadsheetId;
    if (!spreadsheetId) {
      spreadsheetId = await api.createSpreadsheet("Money Pocket", SHEET_NAMES);
      await db.update(schema.integrations).set({ spreadsheetId }).where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google_sheets")));
    } else {
      await api.ensureSheets(spreadsheetId, SHEET_NAMES);
    }
    const data = await buildSheetData(db, userId);
    const rows = await api.replaceAll(spreadsheetId, data);
    await db.update(schema.integrations).set({ dirty: false, lastSyncAt: new Date(), lastError: null, failures: 0 })
      .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google_sheets")));
    const [done] = await db.update(schema.syncJobs).set({ status: "success", rowsWritten: rows, finishedAt: new Date() }).where(eq(schema.syncJobs.id, job.id)).returning();
    return done;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(schema.integrations).set({ lastError: msg.slice(0, 500), failures: integ.failures + 1 })
      .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google_sheets")));
    const [failed] = await db.update(schema.syncJobs).set({ status: "error", error: msg.slice(0, 500), finishedAt: new Date() }).where(eq(schema.syncJobs.id, job.id)).returning();
    return failed;
  }
}

/** Scheduler pass: sync integrations with pending changes, backing off after failures. */
export async function syncDirtyIntegrations() {
  if (!googleConfigured()) return 0;
  const db = await getDb();
  const rows = await db.select().from(schema.integrations).where(and(eq(schema.integrations.provider, "google_sheets"), eq(schema.integrations.dirty, true), eq(schema.integrations.autoSync, true)));
  let n = 0;
  for (const r of rows) {
    if (r.failures > 0) {
      const [last] = await db.select().from(schema.syncJobs).where(eq(schema.syncJobs.userId, r.userId)).orderBy(desc(schema.syncJobs.startedAt)).limit(1);
      const backoffMin = Math.min(24 * 60, 2 ** Math.min(r.failures, 10));
      if (last && Date.now() - last.startedAt.getTime() < backoffMin * 60000) continue;
    }
    await syncUser(db, r.userId, "auto");
    n++;
  }
  return n;
}
