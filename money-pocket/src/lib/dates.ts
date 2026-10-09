/** Date helpers that work on "YYYY-MM-DD" local-date strings (calendar dates, no time). */

export type Period = "day" | "week" | "month" | "year" | "custom";
export const PERIODS: Period[] = ["day", "week", "month", "year", "custom"];

export interface DateRange {
  start: string; // inclusive
  end: string; // inclusive
}

const RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDateStr(s: unknown): s is string {
  return typeof s === "string" && RE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

function toUTC(d: string): Date {
  return new Date(d + "T00:00:00Z");
}
function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = toUTC(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUTC(x);
}

export function addMonths(d: string, n: number): string {
  const x = toUTC(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return fromUTC(x);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86400000);
}

/** Monday-based weekday 0..6 */
export function weekday(d: string): number {
  return (toUTC(d).getUTCDay() + 6) % 7;
}

export function startOfWeek(d: string): string {
  return addDays(d, -weekday(d));
}
export function startOfMonth(d: string): string {
  return d.slice(0, 8) + "01";
}
export function endOfMonth(d: string): string {
  return addDays(addMonths(startOfMonth(d), 1), -1);
}
export function startOfYear(d: string): string {
  return d.slice(0, 4) + "-01-01";
}

/** Current calendar date in a given IANA time zone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return localDateOf(now, tz);
}

export function localDateOf(instant: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** "HH:MM" wall-clock time in a time zone. */
export function localTimeOf(instant: Date, tz: string): string {
  try {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
    return s;
  } catch {
    return instant.toISOString().slice(11, 16);
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function rangeFor(period: Period, today: string, custom?: Partial<DateRange>): DateRange {
  switch (period) {
    case "day":
      return { start: today, end: today };
    case "week":
      return { start: startOfWeek(today), end: addDays(startOfWeek(today), 6) };
    case "month":
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case "year":
      return { start: startOfYear(today), end: today.slice(0, 4) + "-12-31" };
    case "custom": {
      const start = isDateStr(custom?.start) ? custom!.start! : startOfMonth(today);
      const end = isDateStr(custom?.end) ? custom!.end! : today;
      return start <= end ? { start, end } : { start: end, end: start };
    }
  }
}

/** The equivalent previous range (previous day/week/month/year, or same-length window). */
export function previousRange(period: Period, r: DateRange): DateRange {
  switch (period) {
    case "day":
      return { start: addDays(r.start, -1), end: addDays(r.end, -1) };
    case "week":
      return { start: addDays(r.start, -7), end: addDays(r.end, -7) };
    case "month": {
      const s = addMonths(r.start, -1);
      return { start: s, end: endOfMonth(s) };
    }
    case "year": {
      const y = Number(r.start.slice(0, 4)) - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    case "custom": {
      const len = diffDays(r.start, r.end) + 1;
      return { start: addDays(r.start, -len), end: addDays(r.start, -1) };
    }
  }
}

export type Bucket = "day" | "week" | "month";

export function bucketFor(r: DateRange): Bucket {
  const len = diffDays(r.start, r.end) + 1;
  if (len <= 62) return "day";
  if (len <= 190) return "week";
  return "month";
}

export function bucketKey(d: string, b: Bucket): string {
  if (b === "day") return d;
  if (b === "week") return startOfWeek(d);
  return d.slice(0, 7);
}

export function bucketKeys(r: DateRange, b: Bucket): string[] {
  const out: string[] = [];
  let cur = b === "day" ? r.start : b === "week" ? startOfWeek(r.start) : startOfMonth(r.start);
  while (cur <= r.end) {
    out.push(bucketKey(cur, b));
    cur = b === "day" ? addDays(cur, 1) : b === "week" ? addDays(cur, 7) : addMonths(cur, 1);
  }
  return out;
}

/** Combine a local date + "HH:MM" in a time zone into a UTC instant. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [h, m] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h || 0, m || 0));
  // Find the zone offset at that instant and correct (one iteration is enough outside DST gaps).
  const offset = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offset * 60000);
}

export function tzOffsetMinutes(instant: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUTC - instant.getTime()) / 60000);
  } catch {
    return 0;
  }
}
