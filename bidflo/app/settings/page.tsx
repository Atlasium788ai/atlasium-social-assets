import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BidSettingsForm } from "@/components/bid-settings-form";
import { FollowUpSettingsForm } from "@/components/follow-up-settings-form";
import { SettingsForm } from "@/components/settings-form";
import { getAdminSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getDashboardMetrics } from "@/lib/queries";
import { integrationReadiness } from "@/lib/integration-readiness";
import type { FollowUpRules } from "@/lib/follow-up";
import type { QualificationRules } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getAdminSession();
  if (!session?.user?.email) redirect("/login");
  const [settings, metrics] = await Promise.all([
    db()`select qualification_rules, capability_profile, proposal_rules from bidflo_settings where id = 'default'`,
    getDashboardMetrics(),
  ]);
  const row = settings[0];
  const proposalRules = row.proposal_rules as Record<string, unknown>;
  const readiness = integrationReadiness(process.env);
  const processor = metrics.processor as { last_checked_at?: string | null; last_data_processed_at?: string | null; retrying?: number; failed?: number };
  const time = (value?: string | null) => value ? new Date(value).toLocaleString("en-CA", { timeZone: "America/Toronto" }) : "Not yet recorded";
  return <AppShell email={session.user.email} publicAccess={session.user.name === "Visez Preview"}>
    <main className="section-page section-settings">
      <header className="section-hero"><div><p className="eyebrow">BUSINESS RULES &amp; HEALTH</p><h1>Visez settings.</h1><p>One place for opportunity, proposal, follow-up, and integration controls.</p></div><span className="section-index">SETTINGS</span></header>
      <section className="follow-metrics integration-metrics" aria-label="Integration status">
        <article><small>Opportunity inbox</small><strong>{readiness.upworkEmailIntake.ready ? "Ready" : "Action needed"}</strong></article>
        <article><small>Proposal intelligence</small><strong>{readiness.ai.ready ? "Ready" : "Action needed"}</strong></article>
        <article><small>Private Slack</small><strong>{readiness.slack.ready ? "Ready" : "Action needed"}</strong></article>
        <article><small>Five-minute processor</small><strong>{processor?.failed ? "Error" : processor?.last_checked_at ? "Active" : "Awaiting check"}</strong></article>
      </section>
      <section className="card operations-health"><p className="eyebrow">VERIFIED SERVER ACTIVITY</p><p>Last processor check: <strong>{time(processor?.last_checked_at)}</strong></p><p>Last real inbound data processed: <strong>{time(processor?.last_data_processed_at)}</strong></p><p>Retrying: <strong>{processor?.retrying ?? 0}</strong> · Failed: <strong>{processor?.failed ?? 0}</strong></p></section>
      <div className="settings-stack">
        <section className="card"><p className="eyebrow">OPPORTUNITY QUALIFICATION</p><SettingsForm initial={row.qualification_rules as QualificationRules} /></section>
        <section className="card"><p className="eyebrow">PROPOSAL QUALITY &amp; PRICING</p><BidSettingsForm profile={row.capability_profile as never} rules={proposalRules as never} /></section>
        <section className="card"><p className="eyebrow">FOLLOW-UP TIMING</p><FollowUpSettingsForm initial={(proposalRules.followUp ?? {}) as FollowUpRules} /></section>
      </div>
    </main>
  </AppShell>;
}
