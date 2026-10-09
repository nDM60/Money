"use client";
import { useEffect, useState } from "react";
import { translate, LANGUAGE_NAMES, type Key } from "@/lib/i18n";
import { LANGUAGES, type Lang } from "@/lib/domain";

export function useAuthLang() {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    const saved = localStorage.getItem("mp-lang") as Lang | null;
    const nav = navigator.language.slice(0, 2) as Lang;
    setLang(saved && LANGUAGES.includes(saved) ? saved : LANGUAGES.includes(nav) ? nav : "en");
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const change = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem("mp-lang", l); } catch {}
  };
  return { lang, setLang: change, t: (k: Key, v?: Record<string, string | number>) => translate(lang, k, v) };
}

export function AuthFrame({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: React.ReactNode }) {
  return (
    <div className="hero flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-2xl shadow-lg" />
            <div>
              <div className="text-lg font-bold tracking-tight">Money Pocket</div>
              <div className="text-xs text-white/70">{translate(lang, "app.tagline")}</div>
            </div>
          </div>
          <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-sm text-white">
            {LANGUAGES.map((l) => <option key={l} value={l} className="text-black">{LANGUAGE_NAMES[l]}</option>)}
          </select>
        </div>
        <div className="card p-6 text-ink sm:p-8">{children}</div>
      </div>
    </div>
  );
}
