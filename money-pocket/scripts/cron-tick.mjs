#!/usr/bin/env node
// Calls the scheduler endpoint once. Use from system cron / GitHub Actions:
//   */10 * * * *  APP_URL=https://money.example.com CRON_SECRET=... node scripts/cron-tick.mjs
const url = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/cron/tick`;
const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
