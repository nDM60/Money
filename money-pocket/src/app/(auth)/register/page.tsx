"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import { errorText } from "@/client/app";
import { Field, Spinner } from "@/components/ui";
import { CURRENCY_CODES } from "@/lib/money";
import { AuthFrame, useAuthLang } from "../auth-ui";

export default function RegisterPage() {
  const { lang, setLang, t } = useAuthLang();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currency, setCurrency] = useState("LAK");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Vientiane";
      await api("/api/auth/register", { body: { name, email, password, language: lang, currency, timezone } });
      router.replace("/setup");
      router.refresh();
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }
  return (
    <AuthFrame lang={lang} setLang={setLang}>
      <h1 className="text-xl font-bold">{t("auth.create_title")}</h1>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label={t("auth.your_name")}><input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label={t("auth.email")}><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label={t("auth.password")} hint={t("auth.password_hint")}><input className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Field label={t("set.primary_currency")}>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        {error && <p className="text-sm font-medium text-bad" role="alert">{error}</p>}
        <button className="btn btn-primary w-full !py-3" disabled={busy}>{busy ? <Spinner /> : t("auth.register")}</button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">{t("auth.have_account")} <Link href="/login" className="font-semibold text-brand">{t("auth.login")}</Link></p>
      <p className="mt-4 text-center text-[11px] text-muted">{t("auth.secure_note")}</p>
    </AuthFrame>
  );
}
