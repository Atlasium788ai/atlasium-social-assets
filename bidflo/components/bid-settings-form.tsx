"use client";

import { FormEvent, useState } from "react";

type Profile = { company?: string; positioning?: string; services?: string[]; deliveryStandards?: string[]; proof?: string[] };
type Rules = { maxWords?: number; minimumQualityScore?: number; tone?: string; bannedPhrases?: string[]; requiredSections?: string[]; approvalRequired?: boolean; pricingNotes?: string };

export function BidSettingsForm({ profile, rules }: { profile: Profile; rules: Rules }) {
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice("Saving…");
    const form = new FormData(event.currentTarget);
    const list = (name: string) => String(form.get(name) ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
    const payload = { section: "bid", capabilityProfile: { company: "Atlasium 7/88", positioning: String(form.get("positioning")), services: list("services"), proof: list("proof"), deliveryStandards: list("deliveryStandards") }, proposalRules: { ...rules, maxWords: Number(form.get("maxWords")), minimumQualityScore: Number(form.get("minimumQualityScore")), tone: String(form.get("tone")), pricingNotes: String(form.get("pricingNotes")), bannedPhrases: list("bannedPhrases"), requiredSections: list("requiredSections"), approvalRequired: true } };
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setNotice(response.ok ? "Bidding rules saved." : "Could not save bidding rules.");
  }
  return <form className="settings-form rules-form" onSubmit={submit}>
    <div className="form-row"><label>Proposal maximum words<input name="maxWords" type="number" min="80" max="800" defaultValue={rules.maxWords ?? 350} /></label><label>Minimum QC score<input name="minimumQualityScore" type="number" min="0" max="100" defaultValue={rules.minimumQualityScore ?? 80} /></label></div>
    <label>Writing style<input name="tone" defaultValue={rules.tone ?? "direct, specific, commercially aware"} /></label>
    <label>Pricing and commercial rules<textarea name="pricingNotes" rows={3} defaultValue={rules.pricingNotes ?? "Protect Atlasium's target margin. Recommend clear milestones and never underprice delivery risk."} /></label>
    <label>Services and qualifications <small>One per line</small><textarea name="services" rows={4} defaultValue={(profile.services ?? []).join("\n")} /></label>
    <label>Approved proof points <small>Only verified claims; one per line</small><textarea name="proof" rows={3} defaultValue={(profile.proof ?? []).join("\n")} /></label>
    <label>Delivery standards <small>One per line</small><textarea name="deliveryStandards" rows={4} defaultValue={(profile.deliveryStandards ?? []).join("\n")} /></label>
    <label>Required proposal sections <small>One per line</small><textarea name="requiredSections" rows={3} defaultValue={(rules.requiredSections ?? []).join("\n")} /></label>
    <label>Never use these phrases <small>One per line</small><textarea name="bannedPhrases" rows={3} defaultValue={(rules.bannedPhrases ?? []).join("\n")} /></label>
    <input type="hidden" name="positioning" value={profile.positioning ?? "Intelligent systems, automation, product engineering, and revenue operations"} />
    <div className="approval-lock"><span>✓</span><div><strong>Human approval is always required</strong><p>BidFlo prepares and checks proposals but never submits without Blair.</p></div></div>
    <div className="settings-actions"><button className="primary-button">Save bidding rules</button><span>{notice}</span></div>
  </form>;
}
