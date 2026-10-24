"use client";

import { FormEvent, useState } from "react";

type Rules = { firstReminderDays?: number; secondReminderDays?: number; staleAfterDays?: number; notifyOnReply?: boolean };

export function FollowUpSettingsForm({ initial }: { initial: Rules }) {
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice("Saving…");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "followUp", followUpRules: { firstReminderDays: Number(form.get("firstReminderDays")), secondReminderDays: Number(form.get("secondReminderDays")), staleAfterDays: Number(form.get("staleAfterDays")), notifyOnReply: true } }) });
    setNotice(response.ok ? "Follow-up rules saved." : "Could not save follow-up rules.");
  }
  return <form className="settings-form rules-form compact-rules" onSubmit={submit}>
    <div className="form-row"><label>First reminder after<input name="firstReminderDays" type="number" min="1" max="30" defaultValue={initial.firstReminderDays ?? 3} /><small>days</small></label><label>Second reminder after<input name="secondReminderDays" type="number" min="2" max="60" defaultValue={initial.secondReminderDays ?? 7} /><small>days</small></label></div>
    <label>Mark as stale after<input name="staleAfterDays" type="number" min="3" max="120" defaultValue={initial.staleAfterDays ?? 14} /></label>
    <div className="approval-lock aqua-lock"><span>✓</span><div><strong>Reply alerts are active</strong><p>New client replies move to the top of this workspace.</p></div></div>
    <div className="settings-actions"><button className="primary-button aqua-button">Save follow-up rules</button><span>{notice}</span></div>
  </form>;
}
