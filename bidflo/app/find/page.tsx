import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OpportunityBoard } from "@/components/opportunity-board";
import { CaptureUpworkJob } from "@/components/capture-upwork-job";
import { SettingsForm } from "@/components/settings-form";
import { getAdminSession, isAuthDisabled } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { listOpportunityCards } from "@/lib/queries";
import type { QualificationRules } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FindPage() {
  const session = await getAdminSession(); if (!session?.user?.email) redirect("/login");
  const [opportunities, settings] = await Promise.all([listOpportunityCards(), db()`select qualification_rules from bidflo_settings where id = 'default'`]);
  return <AppShell email={session.user.email} publicAccess={isAuthDisabled()}><main className="section-page section-find"><header className="section-hero"><div><p className="eyebrow">01 · TRAIN YOUR AGENT</p><h1>Find the right opportunities.</h1><p>Tell Visez which industries, services, budgets, and clients Atlasium should pursue.</p></div><span className="section-index">FIND</span></header><CaptureUpworkJob /><div className="section-layout"><OpportunityBoard opportunities={opportunities} mode="find" /><aside className="rules-panel"><div className="rules-heading"><span>01</span><div><h2>Discovery rules</h2><p>Controls how opportunities are scored and filtered.</p></div></div><SettingsForm initial={settings[0].qualification_rules as QualificationRules} /></aside></div></main></AppShell>;
}
