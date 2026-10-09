import type { Lang } from "../domain";
import en from "./en";
import lo from "./lo";
import th from "./th";
import vi from "./vi";

export type Key = keyof typeof en;
export type Dict = Record<Key, string>;

export const DICTS: Record<Lang, Dict> = { en, lo, th, vi };

export function translate(lang: Lang | string, key: Key, vars?: Record<string, string | number>): string {
  const d = DICTS[lang as Lang] ?? en;
  let s: string = d[key] ?? en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", lo: "ລາວ", th: "ไทย", vi: "Tiếng Việt" };
