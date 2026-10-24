"use client";

import { FormEvent, useState } from "react";

type Rules = {
  minimumScore: number; autoPrepareScore: number; minimumBudget: number; targetHourlyRate: number;
  serviceFitKeywords: string[]; poorFitKeywords: string[]; complexityPenaltyKeywords: string[]; recurringKeywords: string[];
};

export function SettingsForm({ initial }: { initial: Rules }) {
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice("Saving…");
    const form = new FormData(event.currentTarget);
    const list = (name: string) => String(form.get(name) ?? "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    const payload = {
      section: "qualification",
      minimumScore: Number(form.get("minimumScore")), autoPrepareScore: Number(form.get("autoPrepareScore")),
      minimumBudget: Number(form.get("minimumBudget")), targetHourlyRate: Number(form.get("targetHourlyRate")),
      serviceFitKeywords: list("serviceFitKeywords"), poorFitKeywords: list("poorFitKeywords"),
      complexityPenaltyKeywords: list("complexityPenaltyKeywords"), recurringKeywords: list("recurringKeywords"),
    };
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setNotice(response.ok ? "Scoring rules saved." : "Could not save scoring rules.");
  }
  return <form className="settings-form rules-form" onSubmit={submit}>
    <div className="form-row"><label>Reject below<input name="minimumScore" type="number" min="0" max="100" defaultValue={initial.minimumScore} /></label><label>Auto-prepare at<input name="autoPrepareScore" type="number" min="0" max="100" defaultValue={initial.autoPrepareScore} /></label></div>
    <div className="form-row"><label>Minimum project budget<input name="minimumBudget" type="number" min="0" defaultValue={initial.minimumBudget} /></label><label>Target hourly rate<input name="targetHourlyRate" type="number" min="1" defaultValue={initial.targetHourlyRate} /></label></div>
    <label>Industries, services, and fit signals <small>One per line</small><textarea name="serviceFitKeywords" rows={5} defaultValue={initial.serviceFitKeywords.join("\n")} /></label>
    <label>Automatic rejection signals <small>One per line</small><textarea name="poorFitKeywords" rows={4} defaultValue={initial.poorFitKeywords.join("\n")} /></label>
    <label>Delivery complexity signals <small>One per line</small><textarea name="complexityPenaltyKeywords" rows={3} defaultValue={initial.complexityPenaltyKeywords.join("\n")} /></label>
    <label>Recurring revenue signals <small>One per line</small><textarea name="recurringKeywords" rows={3} defaultValue={initial.recurringKeywords.join("\n")} /></label>
    <div className="settings-actions"><button className="primary-button">Save discovery rules</button><span>{notice}</span></div>
  </form>;
}
