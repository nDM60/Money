"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { api } from "@/client/api";
import { errorText } from "@/client/app";
import { Field, Spinner } from "@/components/ui";
import { AuthFrame, useAuthLang } from "../auth-ui";

export default function LoginPage() {
  const { lang, setLang, t } = useAuthLang();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "login" | "demo">("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("login");
    setError(null);
    try {
      await api("/api/auth/login", { body: { email, password } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorText(t, err));
      setBusy("");
    }
  }
  async function demo() {
    setBusy("demo");
    try {
      await api("/api/auth/demo", { body: { language: lang } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorText(t, err));
      setBusy("");
    }
  }
  return (
    <AuthFrame lang={lang} setLang={setLang}>
      <h1 className="text-xl font-bold">{t("auth.welcome")}</h1>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label={t("auth.email")}><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label={t("auth.password")}><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <p className="text-sm font-medium text-bad" role="alert">{error}</p>}
        <button className="btn btn-primary w-full !py-3" disabled={!!busy}>{busy === "login" ? <Spinner /> : t("auth.login")}</button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">{t("auth.no_account")} <Link href="/register" className="font-semibold text-brand">{t("auth.register")}</Link></p>
      <div className="mt-6 border-t border-line pt-5">
        <button className="btn btn-soft w-full" onClick={demo} disabled={!!busy}>{busy === "demo" ? <Spinner /> : t("auth.try_demo")}</button>
        <p className="mt-2 text-center text-xs text-muted">{t("auth.demo_hint")}</p>
      </div>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted"><Lock size={12} />{t("auth.secure_note")}</p>
    </AuthFrame>
  );
}
