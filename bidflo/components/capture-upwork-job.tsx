"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CaptureUpworkJob() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");

  async function capture(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setNotice("");
    try {
      const budgetUsd = budget.trim() ? Number(budget) : null;
      if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd < 0)) {
        throw new Error("Enter a valid budget or leave it blank.");
      }
      const response = await fetch("/api/find/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, jobUrl, description, budgetUsd }),
      });
      const data = await response.json() as {
        opportunityId?: string;
        duplicate?: boolean;
        error?: string;
        note?: string;
      };
      if (!response.ok || !data.opportunityId) throw new Error(data.error ?? "Could not add this job.");
      router.push(`/opportunities/${data.opportunityId}`);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add this job.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <details className="quick-capture">
      <summary><span><strong>+ Add an Upwork job</strong><small>Paste a genuine listing to score it and prepare a draft.</small></span><span aria-hidden="true">+</span></summary>
      <form onSubmit={(event) => void capture(event)} className="quick-capture-form">
        <label>Upwork job URL
          <input required type="url" inputMode="url" placeholder="https://www.upwork.com/jobs/..." value={jobUrl} onChange={(event) => setJobUrl(event.target.value)} maxLength={900}/>
        </label>
        <label>Job title
          <input required placeholder="Paste the actual job title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={8} maxLength={180}/>
        </label>
        <label>Client's project description
          <textarea required rows={4} minLength={80} maxLength={12000} placeholder="Paste the genuine job description and requirements from Upwork." value={description} onChange={(event) => setDescription(event.target.value)}/>
        </label>
        <div className="quick-capture-actions">
          <label>Budget (USD, optional)
            <input type="number" step="0.01" min="0" max="10000000" placeholder="e.g. 2500" value={budget} onChange={(event) => setBudget(event.target.value)}/>
          </label>
          <button className="primary-button" type="submit" disabled={working}>{working ? "Preparing…" : "Score & prepare draft"}</button>
        </div>
        <p className="quick-capture-caption">No bids or messages are sent. The original Upwork link stays with your opportunity.</p>
        {notice && <p role="alert" className="quick-capture-error">{notice}</p>}
      </form>
    </details>
  );
}
