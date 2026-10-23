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
    const list = (name: string) => String(form.get(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const payload = {
      minimumScore: Number(form.get("minimumScore")), autoPrepareScore: Number(form.get("autoPrepareScore")),
      minimumBudget: Number(form.get("minimumBudget")), targetHourlyRate: Number(form.get("targetHourlyRate")),
      serviceFitKeywords: list("serviceFitKeywords"), poorFitKeywords: list("poorFitKeywords"),
      complexityPenaltyKeywords: list("complexityPenaltyKeywords"), recurringKeywords: list("recurringKeywords"),
    };
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setNotice(response.ok ? "Scoring rules saved." : "Could not save scoring rules.");
  }
  return <form className="settings-form card" onSubmit={submit}>
    <div className="form-row four"><label>Reject below<input name="minimumScore" type="number" min="0" max="100" defaultValue={initial.minimumScore} /></label><label>Auto-prepare at<input name="autoPrepareScore" type="number" min="0" max="100" defaultValue={initial.autoPrepareScore} /></label><label>Minimum budget<input name="minimumBudget" type="number" min="0" defaultValue={initial.minimumBudget} /></label><label>Target hourly rate<input name="targetHourlyRate" type="number" min="1" defaultValue={initial.targetHourlyRate} /></label></div>
    <label>Service-fit keywords<textarea name="serviceFitKeywords" rows={3} defaultValue={initial.serviceFitKeywords.join(", ")} /></label>
    <label>Poor-fit auto-reject signals<textarea name="poorFitKeywords" rows={3} defaultValue={initial.poorFitKeywords.join(", ")} /></label>
    <label>Complexity penalty signals<textarea name="complexityPenaltyKeywords" rows={3} defaultValue={initial.complexityPenaltyKeywords.join(", ")} /></label>
    <label>Recurring revenue signals<textarea name="recurringKeywords" rows={3} defaultValue={initial.recurringKeywords.join(", ")} /></label>
    <div className="settings-actions"><button className="primary-button">Save rules</button><span>{notice}</span></div>
  </form>;
}
