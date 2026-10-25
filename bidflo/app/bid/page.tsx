import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BidSettingsForm } from "@/components/bid-settings-form";
import { OpportunityBoard } from "@/components/opportunity-board";
import { getAdminSession, isAuthDisabled } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { listOpportunityCards } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function BidPage() {
  const session = await getAdminSession(); if (!session?.user?.email) redirect("/login");
  const [opportunities, settings] = await Promise.all([listOpportunityCards(), db()`select capability_profile, proposal_rules from bidflo_settings where id = 'default'`]);
  return <AppShell email={session.user.email} publicAccess={isAuthDisabled()}><main className="section-page section-bid"><header className="section-hero"><div><p className="eyebrow">02 · SET YOUR BIDDING RULES</p><h1>Bid with precision.</h1><p>Train Visez on Atlasium’s pricing, qualifications, writing style, and approval requirements.</p></div><span className="section-index">BID</span></header><div className="section-layout"><OpportunityBoard opportunities={opportunities} mode="bid" /><aside className="rules-panel"><div className="rules-heading"><span>02</span><div><h2>Proposal rules</h2><p>Persistent guardrails used for every draft and QC pass.</p></div></div><BidSettingsForm profile={settings[0].capability_profile as never} rules={settings[0].proposal_rules as never} /></aside></div></main></AppShell>;
}
