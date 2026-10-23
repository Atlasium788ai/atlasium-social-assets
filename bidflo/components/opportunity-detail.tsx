"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OpportunityRow, ScoreBreakdown } from "@/lib/types";

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

export function OpportunityDetail({ opportunity, messages }: { opportunity: OpportunityRow; messages: Array<Record<string, unknown>> }) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(opportunity.proposal_body ?? "");
  const [bidAmount, setBidAmount] = useState(Number(opportunity.proposal_bid_amount ?? opportunity.suggested_bid ?? 0));
  const [timeline, setTimeline] = useState(opportunity.proposal_timeline ?? opportunity.suggested_timeline ?? "");
  const [questions, setQuestions] = useState((opportunity.proposal_questions ?? []).join("\n"));
  const breakdown = opportunity.score_breakdown as ScoreBreakdown | null;

  async function action(payload: Record<string, unknown>) {
    setPending(String(payload.action)); setNotice("");
    const response = await fetch(`/api/opportunities/${opportunity.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    setPending("");
    if (!response.ok) { setNotice(data.error ?? "Action failed"); return; }
    setNotice("Saved"); setEditing(false); router.refresh();
  }

  async function submit() {
    setPending("submit"); setNotice("");
    const response = await fetch(`/api/opportunities/${opportunity.id}/submit`, { method: "POST" });
    const data = await response.json();
    setPending("");
    if (!response.ok) { setNotice(data.error ?? "Submission handoff failed"); return; }
    if (data.status === "manual_required") {
      setNotice("Opened the authenticated Upwork job. Paste the approved proposal, submit it there, then confirm below.");
      window.open(data.jobUrl, "_blank", "noopener,noreferrer");
    } else setNotice("Submitted through the authorized integration.");
    router.refresh();
  }

  return (
    <main>
      <header className="detail-header">
        <button className="back-button" onClick={() => router.push("/")}>← Back to opportunities</button>
        <div className="detail-topline"><span className={`status status-${opportunity.status}`}>{opportunity.status.replaceAll("_", " ")}</span><span>Detected {new Date(opportunity.created_at).toLocaleString()}</span></div>
        <div className="detail-title"><div><p className="eyebrow">UPWORK OPPORTUNITY</p><h1>{opportunity.title}</h1><p>{opportunity.client_name ?? "Upwork client"} {opportunity.client_location ? `· ${opportunity.client_location}` : ""}</p></div><div className="hero-score"><strong>{opportunity.score ?? "—"}</strong><span>FIT SCORE</span></div></div>
      </header>
      {notice && <div className="notice" role="status">{notice}</div>}

      <section className="detail-grid">
        <div className="detail-main">
          <article className="card proposal-card">
            <div className="card-heading"><div><p className="eyebrow">PROPOSAL PREVIEW</p><h2>Prepared for approval</h2></div>{opportunity.quality_score != null && <span className="qc-score">QC {opportunity.quality_score}/100</span>}</div>
            {!opportunity.proposal_id ? <div className="empty-state compact"><h3>No proposal prepared yet</h3><p>Opportunities below the auto-prepare threshold remain qualified for manual review.</p><button className="secondary-button" onClick={() => action({ action: "rescore" })}>Score &amp; prepare now</button></div> : editing ? (
              <div className="proposal-editor">
                <label>Proposal<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={14} /></label>
                <div className="form-row"><label>Bid amount<input type="number" value={bidAmount} onChange={(event) => setBidAmount(Number(event.target.value))} /></label><label>Timeline<input value={timeline} onChange={(event) => setTimeline(event.target.value)} /></label></div>
                <label>Questions, one per line<textarea value={questions} onChange={(event) => setQuestions(event.target.value)} rows={4} /></label>
              </div>
            ) : (
              <div className="proposal-copy"><p>{opportunity.proposal_body}</p>{(opportunity.proposal_questions ?? []).length > 0 && <><h3>Questions for the client</h3><ol>{opportunity.proposal_questions!.map((question) => <li key={question}>{question}</li>)}</ol></>}</div>
            )}
            {opportunity.proposal_id && <div className="proposal-actions">
              {editing ? <><button className="primary-button" disabled={Boolean(pending)} onClick={() => action({ action: "edit", body, bidAmount, timeline, questions: questions.split("\n").map((q) => q.trim()).filter(Boolean) })}>Save edits</button><button className="ghost-button" onClick={() => setEditing(false)}>Cancel</button></> : <>
                <button className="primary-button" disabled={Boolean(pending) || opportunity.status === "approved"} onClick={() => action({ action: "approve" })}>{opportunity.status === "approved" ? "Approved" : "Approve proposal"}</button>
                <button className="secondary-button" onClick={() => setEditing(true)}>Edit</button>
                <button className="ghost-button danger" onClick={() => action({ action: "reject", reason: "Rejected by Blair" })}>Reject</button>
              </>}
            </div>}
          </article>

          <article className="card"><div className="card-heading"><div><p className="eyebrow">OPPORTUNITY BRIEF</p><h2>Client requirements</h2></div><a href={opportunity.job_url} target="_blank" rel="noreferrer">Open original ↗</a></div><div className="description-copy">{opportunity.description}</div>{opportunity.requirements?.length > 0 && <ul className="requirements-list">{opportunity.requirements.map((item) => <li key={item}>{item}</li>)}</ul>}</article>
          {messages.length > 0 && <article className="card"><div className="card-heading"><div><p className="eyebrow">CLIENT REPLIES</p><h2>Conversation updates</h2></div></div>{messages.map((message) => <div className="message" key={String(message.id)}><div><strong>{String(message.sender ?? "Client")}</strong><span>{new Date(String(message.received_at ?? message.created_at)).toLocaleString()}</span></div><p>{String(message.body)}</p></div>)}</article>}
        </div>

        <aside className="detail-side">
          <article className="card commercial-card"><p className="eyebrow">RECOMMENDED COMMERCIALS</p><div><small>Bid</small><strong>{money(opportunity.proposal_bid_amount ?? opportunity.suggested_bid)}</strong></div><div><small>Timeline</small><strong>{opportunity.proposal_timeline ?? opportunity.suggested_timeline ?? "TBD"}</strong></div>{(opportunity.proposal_milestones ?? []).map((milestone) => <section key={milestone.name}><span>{milestone.name}</span><b>{money(milestone.amount)}</b><p>{milestone.deliverable}</p></section>)}</article>
          <article className="card score-card"><p className="eyebrow">QUALIFICATION BREAKDOWN</p>{breakdown ? Object.entries(breakdown).filter(([key]) => key !== "reasons").map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><i><b style={{ width: `${Math.min(100, (Number(value) / (key === "serviceFit" ? 25 : key === "recurringRevenue" ? 10 : 15)) * 100)}%` }} /></i><strong>{String(value)}</strong></div>) : <p>Pending score</p>}</article>
          {opportunity.human_judgment_required && <article className="risk-card"><strong>Human judgment required</strong><p>The reviewer detected uncertainty or risk. Check the quality notes and edit before approval.</p></article>}
          <article className="card submit-card"><p className="eyebrow">SUBMISSION</p><h3>{opportunity.status === "approved" ? "Approved and ready" : opportunity.status === "ready_to_submit" ? "Manual submission ready" : "Approval required"}</h3><p>Submission uses the permitted integration when configured. Otherwise BidFlo opens the authenticated Upwork job for your final human-controlled action.</p><button className="primary-button" disabled={!['approved','ready_to_submit'].includes(opportunity.status) || Boolean(pending)} onClick={submit}>{pending === "submit" ? "Preparing…" : "Continue to submission"}</button>{opportunity.status === "ready_to_submit" && <button className="secondary-button" onClick={() => action({ action: "mark_submitted" })}>I submitted this bid</button>}</article>
          {['submitted','replied','interviewed'].includes(opportunity.status) && <article className="card stage-actions"><p className="eyebrow">PIPELINE STAGE</p><div><button onClick={() => action({ action: "set_stage", stage: "interviewed" })}>Interview</button><button onClick={() => action({ action: "set_stage", stage: "won" })}>Won</button><button onClick={() => action({ action: "set_stage", stage: "lost" })}>Lost</button></div></article>}
        </aside>
      </section>
    </main>
  );
}
