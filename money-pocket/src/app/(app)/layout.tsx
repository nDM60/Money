import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userFromToken } from "@/server/auth";
import { AppProvider } from "@/client/app";
import { AppShell } from "@/components/shell";
import { getSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userFromToken(token);
  if (!user) redirect("/login");
  const settings = await getSettings(user.id);
  return (
    <AppProvider initialLang={settings.language} initialCurrency={settings.primaryCurrency}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
