import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { SettingsForm } from "@/components/settings-form";
import type { QualificationRules } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getAdminSession();
  if (!session?.user?.email) redirect("/login");
  const [settings] = await db()`select qualification_rules from bidflo_settings where id = 'default'`;
  return <AppShell email={session.user.email}><main><header className="page-header"><div><p className="eyebrow">CONFIGURATION</p><h1>Qualification rules</h1><p>Tune how BidFlo scores, rejects, and prioritizes Atlasium opportunities.</p></div></header><SettingsForm initial={settings.qualification_rules as QualificationRules} /></main></AppShell>;
}
