# Money Pocket

A multilingual (English · ລາວ · ไทย · Tiếng Việt) personal finance app: real account balances, income/expense/transfer tracking, budgets, savings goals, investments, recurring bills, daily → yearly summaries, scheduled notifications, AI receipt/banknote scanning, Google Sheets mirroring and an AI assistant that works from your own data.

**Core rule:** an existing balance is an *opening balance* (a balance snapshot), never income. Transfers between your own accounts are never income or expenses.

```
Current balance = Opening balance + Income − Expenses + Transfers in − Transfers out ± Adjustments
                  (only movements dated on/after the account's opening date)
```

---

## Quick start

```bash
cd money-pocket
npm install
npm run dev            # http://localhost:3000
```

No database setup is needed for local use: without `DATABASE_URL` the app runs an embedded PostgreSQL (PGlite) stored in `./.data/pglite`. Migrations run automatically on start.

- **Create account** → you are taken to the setup screen to enter each account's *current actual balance* and its effective date.
- **Explore the demo** (login screen) creates a separate, clearly labelled demo user with ~3 months of sample data. Demo data never mixes with real users' records.

```bash
npm test               # acceptance + domain tests (embedded Postgres)
TEST_DATABASE_URL=postgres://user@host:5432/db npm test   # same suite against a real PostgreSQL (drops & recreates the schema!)
npm run lint           # TypeScript type-check
npm run build && npm start
```

## Configuration and integration status

Everything that needs credentials is **off until configured**, and Settings → *Integrations & status* shows what is configured. Copy `.env.example` to `.env.local`.

| Feature | Needs | Without it |
|---|---|---|
| Database | `DATABASE_URL` (PostgreSQL 14+) | Embedded PGlite on local disk (fine for one machine; **not** for serverless hosting) |
| AI assistant (Claude, tool calling) | `ANTHROPIC_API_KEY` | A built-in multilingual rule engine answers the common questions from the same tools |
| Receipt / bill / banknote recognition | `ANTHROPIC_API_KEY` (Claude vision, structured output) | You can still attach the image and enter details manually |
| Scheduled summaries & reminders | `CRON_SECRET` + a cron caller, **or** `INTERNAL_SCHEDULER=true` | In-app budget alerts still fire when you save expenses. Settings says the scheduler has never run. |
| Push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`) | In-app notifications only |
| Email notifications | `RESEND_API_KEY`, `EMAIL_FROM` | Not sent |
| Google Sheets | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`, `APP_SECRET` | CSV/JSON export still works |

Secrets are only read on the server. The browser never sees API keys, OAuth client secrets or tokens.

### Scheduler (end-of-day notifications when the app is closed)

The scheduler pass (`/api/cron/tick`) is idempotent, so it can be called every few minutes. For each user, in their own time zone, it:

- auto-posts recurring transactions marked **auto-post** whose due date has arrived (others wait for you to press *Post*),
- sends bill due/overdue reminders, budget threshold alerts (80/90/100% by default), goal completion,
- after the user's reminder time (default 21:30): the daily summary, and an uncategorized-transactions reminder,
- on Mondays the weekly report and on the 1st the monthly report,
- retries pending or failed Google Sheets syncs with exponential backoff.

Every notification has a dedupe key (for example `daily:2026-10-09`), so repeated calls never send duplicates. Call it with one of these:

- **Vercel Cron**: `vercel.json` schedules `*/10 * * * *`. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically. The Hobby plan only allows daily crons, so use Pro or an external caller.
- **System cron / GitHub Actions**: `APP_URL=… CRON_SECRET=… node scripts/cron-tick.mjs` every 10 minutes.
- **Self-hosted Node** (`npm start` on a VPS): set `INTERNAL_SCHEDULER=true`.

Browser push needs the user's permission. Settings → Notifications explains this and lets them enable push on that device; on iPhone the app must first be added to the Home Screen.

### Google Sheets sync rules

- Scope is `drive.file`: the app can only touch the spreadsheet it creates, not your other files.
- The **database is the source of truth**. Each sync rewrites the 10 worksheets (Accounts, Transactions, Categories, Budgets, Daily/Weekly/Monthly/Yearly Summary, Balance Snapshots, Settings) from the database, with every row keyed by a stable record ID. Repeating a sync never duplicates rows.
- Sync is **one-way** (app → sheet). Edits made in the sheet are overwritten on the next sync; the Settings worksheet says so. Make changes in the app.
- Changes mark the integration *dirty*. The scheduler syncs dirty integrations automatically (if *Sync automatically* is on); *Sync now* runs it on demand. Failures are recorded in the sync history and retried with backoff. OAuth tokens are stored AES-256-GCM encrypted.
- To set up, create a Google Cloud OAuth client (Web application), enable the Google Sheets API and add the redirect URI `$APP_URL/api/integrations/google/callback`.

## Architecture

```
money-pocket/
  src/app/(auth)/…          login, register
  src/app/(app)/…           dashboard, transactions, accounts/[id], budgets, savings, investments,
                            reports, recurring, assistant, notifications, settings, setup
  src/app/api/…             JSON route handlers (all authenticated + user-scoped)
  src/server/db/schema.ts   Drizzle schema (PostgreSQL) — migrations in ./drizzle
  src/server/services/      domain logic: accounts, transactions, reports, summaries, budgets, goals
                            & holdings, recurring, notifications, scheduler, receipts, sheets, chat
  src/lib/                  shared: money (exact minor units), dates, domain rules, i18n (en/lo/th/vi)
  src/components/           UI kit, charts (Recharts), forms, scanner, chat
  tests/                    acceptance tests 1–10 + domain tests
```

- **Stack**: Next.js 15 (App Router) + TypeScript, Tailwind CSS 4, Recharts, Drizzle ORM on PostgreSQL (node-postgres, or PGlite locally), Anthropic SDK, web-push.
- **Money**: integers in each currency's minor unit (LAK/VND 0 decimals, THB/USD 2), no floating-point math. Conversions use exact rational arithmetic on decimal rate strings.
- **Multi-currency**: each transaction stores its original amount/currency, the amounts debited/credited in each account's currency, and a *reporting snapshot* (primary-currency amount + rate used). Adding or deleting exchange rates never rewrites stored transactions; reports show a warning when a rate is missing instead of guessing.
- **Transaction model**: each transaction moves money *from* an owned account (or outside) *to* an owned account (or outside). Only income/refund and expense types count as income/expenses. Transfers, savings contributions, investment buys and sells, and loan or debt movements are internal. Reconciliation differences are recorded as *adjustments*, and realized investment gains as *valuation* entries; both are reported separately.
- **Investments**: purchases move money into an investment account at cost basis, so they are not gains. Sales compute realized gain against average cost. Market value is a manual valuation shown with its date, because no live price feed is connected.
- **Security**: bcrypt password hashes; random session tokens stored as SHA-256 in an HttpOnly, SameSite=Lax cookie (Secure in production); every query is filtered by the authenticated user, and referenced accounts, categories, goals and receipts are ownership-checked; Origin check on mutating requests; database-backed rate limits on login/register/demo/chat/uploads/sync; zod validation on every input; image uploads are sniffed by magic bytes (JPEG/PNG/WebP/GIF, 8 MB max) and served with `Content-Security-Policy: default-src 'none'`; CSV export is protected against formula injection; security headers (no framing, nosniff). Users can export all their data (JSON/CSV) and permanently delete their account, which cascades to every record.
- **Audit trail**: creates, updates, deletes, restores, reconciliations and valuations are written to `audit_log` with before/after values. Transaction deletes are soft deletes, so they can be undone.
- **AI assistant**: Claude is called server-side with a fixed set of tools. Read tools query only the signed-in user's data. `prepare_*` tools only return a prefilled form, so nothing is saved, transferred or deleted until the user confirms in the app. The assistant cannot run code or arbitrary queries.

### Backups and recovery

Use your PostgreSQL provider's automated backups / point-in-time recovery, or `pg_dump` on a schedule. For embedded local mode, back up the `.data/` folder while the app is stopped. Users can also download a full JSON export.

### Deploying

Any Node 20+ host works. For serverless platforms (Vercel, Netlify), set `DATABASE_URL` to a managed PostgreSQL such as Neon, Supabase or RDS, because the embedded database needs a persistent disk. Receipt images are stored in the database (`bytea`, private per user), so no separate object storage is required.

## Acceptance tests

`tests/acceptance.test.ts` runs the brief's tests through the real HTTP route handlers:

1. Opening balance of 5,000,000 LAK → balance 5,000,000, income 0 (plus a 35M LAK multi-account onboarding with a 2M internal transfer: total stays 35M and income/expenses stay 0)
2. 100,000 LAK expense → balance 4,900,000 and expenses +100,000
3. 500,000 LAK internal transfer → source −, destination +, consolidated income/expenses unchanged
4. Switching the dashboard from month to year changes totals according to stored records
5. Receipt scan → editable draft with uncertain fields flagged; nothing saved until confirmation; duplicate detection
6. Google Sheets sync repeated 3× → no duplicate rows, stable IDs, all 10 worksheets
7. All UI keys exist in all 4 languages with matching placeholders; notifications and summaries change with the language
8. "How much did I spend this month?" (in all 4 languages) equals the stored total; another user's data is never included; "Add 50,000 LAK for lunch" only opens a prefilled form
9. Another user's account/transaction IDs return 404 on read, update and delete; posting into a foreign account fails; forged or absent sessions get 401; cross-site POSTs get 403
10. Log out → old session rejected → log in → all data still there

`tests/domain.test.ts` covers exact money math, time zones, multi-currency snapshots, investment cost basis and realized gains, reconciliation, recurring posting rules, budget alert deduplication, the daily-summary schedule, and the multilingual intent parser.

## Translations

Lao, Thai and Vietnamese strings live in `src/lib/i18n/{lo,th,vi}.ts`. They are type-checked against the English dictionary, so a missing key fails the build. They were written for this app and should be reviewed by native speakers before launch.
