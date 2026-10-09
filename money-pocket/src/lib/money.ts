/**
 * Money is always handled as integers in the currency's minor unit.
 * No floating-point arithmetic is used for stored or aggregated amounts.
 */

export const CURRENCIES = {
  LAK: { decimals: 0, symbol: "₭" },
  THB: { decimals: 2, symbol: "฿" },
  VND: { decimals: 0, symbol: "₫" },
  USD: { decimals: 2, symbol: "$" },
} as const;

export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];

export function isCurrency(c: string): c is Currency {
  return c in CURRENCIES;
}

export function decimalsOf(c: string): number {
  return isCurrency(c) ? CURRENCIES[c].decimals : 2;
}

export function assertSafeMinor(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error("Amount out of range");
  return n;
}

/** Parse a user-entered decimal string ("1,250.50", "50000") into minor units. */
export function parseAmount(input: string | number, currency: string): number | null {
  const d = decimalsOf(currency);
  let s = String(input).trim().replace(/[\s,_]/g, "");
  if (s === "") return null;
  const neg = s.startsWith("-");
  if (neg || s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  if (frac.length > d) {
    // Reject more precision than the currency supports, rather than silently rounding.
    if (/[^0]/.test(frac.slice(d))) return null;
  }
  const fracPadded = (frac + "0".repeat(d)).slice(0, d);
  const big = BigInt(int) * 10n ** BigInt(d) + (d > 0 ? BigInt(fracPadded || "0") : 0n);
  const v = neg ? -big : big;
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(v);
}

/** Minor units -> plain decimal string without grouping ("1250.50"). */
export function toDecimalString(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  if (d === 0) return (neg ? "-" : "") + abs.toString();
  const base = 10n ** BigInt(d);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(d, "0");
  return (neg ? "-" : "") + int.toString() + "." + frac;
}

const LOCALE_MAP: Record<string, string> = { en: "en-US", lo: "lo-LA", th: "th-TH", vi: "vi-VN" };
export function intlLocale(lang: string): string {
  return LOCALE_MAP[lang] ?? "en-US";
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function numberFormat(lang: string, d: number, compact: boolean): Intl.NumberFormat {
  const key = `${lang}|${d}|${compact}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(lang), compact
      ? { notation: "compact", maximumFractionDigits: 1 }
      : { minimumFractionDigits: d, maximumFractionDigits: d });
    fmtCache.set(key, f);
  }
  return f;
}

/**
 * Format minor units for display. Display formatting uses the decimal string so
 * large values never lose precision.
 */
export function formatMoney(
  minor: number,
  currency: string,
  lang = "en",
  opts: { sign?: boolean; compact?: boolean; code?: boolean } = {},
): string {
  const d = decimalsOf(currency);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  let body: string;
  if (opts.compact && abs / 10 ** d >= 10000) {
    body = numberFormat(lang, d, true).format(abs / 10 ** d);
  } else {
    const [int, frac] = toDecimalString(abs, currency).split(".");
    const intFmt = numberFormat(lang, 0, false).format(BigInt(int) as unknown as number);
    const decSep = numberFormat(lang, 1, false).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
    body = frac ? intFmt + decSep + frac : intFmt;
  }
  const sign = neg ? "−" : opts.sign && minor > 0 ? "+" : "";
  const sym = opts.code === false ? "" : " " + currency;
  return `${sign}${body}${sym}`;
}

/** Parse an exchange rate decimal string into an exact rational (num/den). */
export function parseRate(rate: string): { num: bigint; den: bigint } {
  const s = rate.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid exchange rate");
  const [i, f = ""] = s.split(".");
  const num = BigInt(i + f);
  const den = 10n ** BigInt(f.length);
  if (num === 0n) throw new Error("Exchange rate must be positive");
  return { num, den };
}

/** Divide with round-half-away-from-zero. */
function divRound(n: bigint, d: bigint): bigint {
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (2n * ad);
  return neg ? -q : q;
}

/**
 * Convert minor units of `from` into minor units of `to`, where
 * `rate` = how many units of `to` one unit of `from` buys (decimal string).
 */
export function convertMinor(minor: number, from: string, to: string, rate: string): number {
  if (from === to) return minor;
  const { num, den } = parseRate(rate);
  const dFrom = BigInt(decimalsOf(from));
  const dTo = BigInt(decimalsOf(to));
  // value_to_minor = minor / 10^dFrom * rate * 10^dTo
  const n = BigInt(minor) * num * 10n ** dTo;
  const d = den * 10n ** dFrom;
  return assertSafeMinor(Number(divRound(n, d)));
}

/** Invert a decimal rate string, keeping 10 significant decimal places. */
export function invertRate(rate: string): string {
  const { num, den } = parseRate(rate);
  const scale = 10n ** 12n;
  const q = divRound(den * scale, num);
  const s = q.toString().padStart(13, "0");
  const out = (s.slice(0, -12) || "0") + "." + s.slice(-12);
  return out.replace(/\.?0+$/, "") || "0";
}

/** Percentage change, only when the baseline is meaningful. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0 || current < 0) return null;
  const ch = ((current - previous) / previous) * 100;
  if (!Number.isFinite(ch)) return null;
  return Math.round(ch);
}
