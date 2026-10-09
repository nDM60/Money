import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, timestamp, bigint, boolean, date, integer, jsonb, index, uniqueIndex, primaryKey, customType, numeric,
} from "drizzle-orm/pg-core";

/** Money columns: integer minor units, exact. */
const money = (name: string) => bigint(name, { mode: "number" });
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});
const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const owner = () => uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" });

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default(""),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: owner(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  language: text("language").notNull().default("en"),
  primaryCurrency: text("primary_currency").notNull().default("LAK"),
  theme: text("theme").notNull().default("system"),
  timezone: text("timezone").notNull().default("Asia/Vientiane"),
  reminderTime: text("reminder_time").notNull().default("21:30"),
  notifyDaily: boolean("notify_daily").notNull().default(true),
  notifyWeekly: boolean("notify_weekly").notNull().default(true),
  notifyMonthly: boolean("notify_monthly").notNull().default(true),
  notifyBudget: boolean("notify_budget").notNull().default(true),
  notifyBills: boolean("notify_bills").notNull().default(true),
  notifyUncategorized: boolean("notify_uncategorized").notNull().default(true),
  channelPush: boolean("channel_push").notNull().default(true),
  channelEmail: boolean("channel_email").notNull().default(false),
  dailyBudget: money("daily_budget"),
  onboarded: boolean("onboarded").notNull().default(false),
  updatedAt: updatedAt(),
});

export const exchangeRates = pgTable("exchange_rates", {
  id: id(),
  userId: owner(),
  base: text("base").notNull(),
  quote: text("quote").notNull(),
  /** 1 unit of base = rate units of quote. Exact decimal. */
  rate: numeric("rate", { precision: 24, scale: 12 }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  createdAt: createdAt(),
}, (t) => [index("fx_user_pair_idx").on(t.userId, t.base, t.quote, t.effectiveDate)]);

export const accounts = pgTable("accounts", {
  id: id(),
  userId: owner(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  institution: text("institution"),
  icon: text("icon").notNull().default("wallet"),
  color: text("color").notNull().default("#0f766e"),
  currency: text("currency").notNull(),
  /** Existing money when the account was added to the app. Never counted as income. */
  openingBalance: money("opening_balance").notNull().default(0),
  openingDate: date("opening_date").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("accounts_user_idx").on(t.userId)]);

export const categories = pgTable("categories", {
  id: id(),
  userId: owner(),
  name: text("name").notNull(),
  /** Stable key for default categories so their names can be translated. */
  systemKey: text("system_key"),
  kind: text("kind").notNull(),
  icon: text("icon").notNull().default("circle"),
  color: text("color").notNull().default("#64748b"),
  parentId: uuid("parent_id"),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("categories_user_idx").on(t.userId)]);

export const savingsGoals = pgTable("savings_goals", {
  id: id(),
  userId: owner(),
  name: text("name").notNull(),
  targetAmount: money("target_amount").notNull(),
  currency: text("currency").notNull(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  targetDate: date("target_date"),
  icon: text("icon").notNull().default("piggy-bank"),
  color: text("color").notNull().default("#1d4ed8"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("goals_user_idx").on(t.userId)]);

export const holdings = pgTable("investment_holdings", {
  id: id(),
  userId: owner(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  symbol: text("symbol"),
  assetType: text("asset_type").notNull().default("other"),
  units: numeric("units", { precision: 28, scale: 10 }).notNull().default("0"),
  /** Cost basis of the units currently held, in the account currency. */
  costBasis: money("cost_basis").notNull().default(0),
  /** Manual or fetched market value of all units held, with its valuation date. */
  marketValue: money("market_value"),
  valuedAt: date("valued_at"),
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [index("holdings_user_idx").on(t.userId)]);

export const recurringRules = pgTable("recurring_rules", {
  id: id(),
  userId: owner(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  amount: money("amount").notNull(),
  currency: text("currency").notNull(),
  fromAccountId: uuid("from_account_id").references(() => accounts.id, { onDelete: "cascade" }),
  toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  frequency: text("frequency").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextDueDate: date("next_due_date").notNull(),
  reminderDaysBefore: integer("reminder_days_before").notNull().default(1),
  /** Post automatically on the due date; otherwise the user posts it explicitly. */
  autoPost: boolean("auto_post").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("recurring_user_idx").on(t.userId)]);

export const receipts = pgTable("receipts", {
  id: id(),
  userId: owner(),
  mode: text("mode").notNull().default("receipt"),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  image: bytea("image"),
  status: text("status").notNull().default("pending"),
  extracted: jsonb("extracted"),
  error: text("error"),
  transactionId: uuid("transaction_id"),
  createdAt: createdAt(),
}, (t) => [index("receipts_user_idx").on(t.userId), index("receipts_hash_idx").on(t.userId, t.sha256)]);

export const transactions = pgTable("transactions", {
  id: id(),
  userId: owner(),
  type: text("type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  /** Calendar date in the user's time zone at entry time; used for reporting. */
  localDate: date("local_date").notNull(),
  fromAccountId: uuid("from_account_id").references(() => accounts.id, { onDelete: "restrict" }),
  toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "restrict" }),
  /** Original amount in the original transaction currency (always positive). */
  amount: money("amount").notNull(),
  currency: text("currency").notNull(),
  /** Amount debited from the source account, in that account's currency. */
  fromAmount: money("from_amount"),
  /** Amount credited to the destination account, in that account's currency. */
  toAmount: money("to_amount"),
  /** Snapshot of the reporting conversion at entry time. Never silently changed. */
  reportingCurrency: text("reporting_currency").notNull(),
  reportingAmount: money("reporting_amount").notNull(),
  fxRate: numeric("fx_rate", { precision: 24, scale: 12 }).notNull().default("1"),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  description: text("description").notNull().default(""),
  merchant: text("merchant"),
  paymentMethod: text("payment_method"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  notes: text("notes"),
  receiptId: uuid("receipt_id"),
  recurringId: uuid("recurring_id").references(() => recurringRules.id, { onDelete: "set null" }),
  goalId: uuid("goal_id").references(() => savingsGoals.id, { onDelete: "set null" }),
  holdingId: uuid("holding_id").references(() => holdings.id, { onDelete: "set null" }),
  units: numeric("units", { precision: 28, scale: 10 }),
  /** Links a system-generated valuation entry to the sale that produced it. */
  parentId: uuid("parent_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("tx_user_date_idx").on(t.userId, t.localDate),
  index("tx_user_from_idx").on(t.userId, t.fromAccountId),
  index("tx_user_to_idx").on(t.userId, t.toAccountId),
  index("tx_user_cat_idx").on(t.userId, t.categoryId),
]);

export const balanceSnapshots = pgTable("balance_snapshots", {
  id: id(),
  userId: owner(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // opening | reconciliation
  actualBalance: money("actual_balance").notNull(),
  calculatedBalance: money("calculated_balance").notNull(),
  difference: money("difference").notNull().default(0),
  effectiveDate: date("effective_date").notNull(),
  adjustmentTxId: uuid("adjustment_tx_id"),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [index("snapshots_user_idx").on(t.userId, t.accountId)]);

export const budgets = pgTable("budgets", {
  id: id(),
  userId: owner(),
  /** null = overall spending budget */
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  amount: money("amount").notNull(),
  currency: text("currency").notNull(),
  thresholds: integer("thresholds").array().notNull().default(sql`'{80,90,100}'::int[]`),
  rollover: boolean("rollover").notNull().default(false),
  startDate: date("start_date").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("budgets_user_idx").on(t.userId)]);

export const notifications = pgTable("notifications", {
  id: id(),
  userId: owner(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data"),
  dedupeKey: text("dedupe_key"),
  readAt: timestamp("read_at", { withTimezone: true }),
  pushStatus: text("push_status"),
  emailStatus: text("email_status"),
  createdAt: createdAt(),
}, (t) => [index("notif_user_idx").on(t.userId, t.createdAt), uniqueIndex("notif_dedupe_uq").on(t.userId, t.dedupeKey)]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: owner(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("push_endpoint_uq").on(t.endpoint)]);

export const chatSessions = pgTable("chat_sessions", {
  id: id(),
  userId: owner(),
  title: text("title").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("chat_sessions_user_idx").on(t.userId)]);

export const chatMessages = pgTable("chat_messages", {
  id: id(),
  sessionId: uuid("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  userId: owner(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  /** Structured UI payloads (charts, transaction lists, action cards). */
  ui: jsonb("ui"),
  createdAt: createdAt(),
}, (t) => [index("chat_messages_session_idx").on(t.sessionId, t.createdAt)]);

export const integrations = pgTable("integrations", {
  userId: owner(),
  provider: text("provider").notNull(),
  spreadsheetId: text("spreadsheet_id"),
  /** AES-256-GCM encrypted OAuth refresh token. */
  refreshTokenEnc: text("refresh_token_enc"),
  accessTokenEnc: text("access_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  autoSync: boolean("auto_sync").notNull().default(true),
  dirty: boolean("dirty").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  failures: integer("failures").notNull().default(0),
  connectedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.provider] })]);

export const syncJobs = pgTable("sync_jobs", {
  id: id(),
  userId: owner(),
  provider: text("provider").notNull(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  rowsWritten: integer("rows_written").notNull().default(0),
  error: text("error"),
  startedAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("sync_jobs_user_idx").on(t.userId, t.startedAt)]);

export const auditLog = pgTable("audit_log", {
  id: id(),
  userId: owner(),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: createdAt(),
}, (t) => [index("audit_user_idx").on(t.userId, t.createdAt)]);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

export const systemState = pgTable("system_state", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: updatedAt(),
});
