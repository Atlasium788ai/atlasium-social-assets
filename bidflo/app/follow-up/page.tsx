import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FollowUpSettingsForm } from "@/components/follow-up-settings-form";
import { OpportunityBoard } from "@/components/opportunity-board";
import { getAdminSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getFollowUpState, type FollowUpRules } from "@/lib/follow-up";
import { getDashboardMetrics, listOpportunityCards } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function FollowUpPage() {
  const session = await getAdminSession(); if (!session?.user?.email) redirect("/login");
  const [opportunities, metrics, settings] = await Promise.all([listOpportunityCards(), getDashboardMetrics(), db()`select proposal_rules from bidflo_settings where id = 'default'`]);
  const pipeline = metrics as unknown as { pipeline: string; submitted: number; won: number };
  const followUp = ((settings[0].proposal_rules as Record<string, unknown>).followUp ?? {}) as FollowUpRules;
  const activeStatuses = new Set(["submitted", "replied", "interviewed"]);
  const tracked = opportunities.map((item) => activeStatuses.has(item.status) ? { ...item, follow_up_state: getFollowUpState(item.updated_at, followUp) } : item);
  const dueNow = tracked.filter((item) => item.follow_up_state?.due).length;
  return <AppShell email={session.user.email} publicAccess={session.user.name === "Visez Preview"}><main className="section-page section-follow"><header className="section-hero"><div><p className="eyebrow">03 · MANAGE OPPORTUNITIES</p><h1>Never lose momentum.</h1><p>Track submitted bids, client replies, reminders, and the next action on every opportunity.</p></div><span className="section-index">FOLLOW UP</span></header><section className="follow-metrics"><article><small>Active fixed-price pipeline</small><strong>${Number(pipeline.pipeline).toLocaleString()}</strong></article><article><small>Applications tracked</small><strong>{pipeline.submitted}</strong></article><article><small>Due now</small><strong>{dueNow}</strong></article><article><small>Wins</small><strong>{pipeline.won}</strong></article></section><div className="section-layout"><OpportunityBoard opportunities={tracked} mode="follow" /><aside className="rules-panel"><div className="rules-heading"><span>03</span><div><h2>Follow-up rules</h2><p>Simple reminders and reply notifications.</p></div></div><FollowUpSettingsForm initial={followUp} /></aside></div></main></AppShell>;
}
