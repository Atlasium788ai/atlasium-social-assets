"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReplyAssistant } from "@/components/reply-assistant";
import { requiredProposalOpening, proposalApprovalIssues } from "@/lib/application-rules";
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
  const requiredOpening = requiredProposalOpening(opportunity.description);
  const currentProposal = editing ? body : String(opportunity.proposal_body ?? "");
  const approvalIssues = proposalApprovalIssues(opportunity.description, currentProposal);
  const missingOpening = Boolean(requiredOpening) && approvalIssues.some((issue) => issue.startsWith("Start the proposal"));
  const latestClientReply = messages.find((message) => message.direction === "inbound" && message.kind === "client_reply");
  const proposalLocked = ["ready_to_submit", "submission_processing", "submitted", "replied", "interviewed", "won", "lost"].includes(opportunity.status);

  async function action(payload: Record<string, unknown>) {
    if (pending) return;
    setPending(String(payload.action)); setNotice("");
    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        const details = Array.isArray(data.issues) && data.issues.length > 1 ? ` Also: ${data.issues.slice(1).join("; ")}` : "";
        setNotice((data.error ?? "Action failed") + details);
        return;
      }
      const preflight = Array.isArray(data.preflightIssues) && data.preflightIssues.length
        ? `Saved for review. Before approval: ${data.preflightIssues.join("; ")}`
        : "Saved";
      setNotice(preflight); setEditing(false); router.refresh();
    } catch {
      setNotice("Could not reach Visez. Please retry once the connection is restored.");
    } finally { setPending(""); }
  }

  async function submit() {
    if (pending) return;
    setPending("submit"); setNotice("");
    // Open immediately in the user gesture; mobile browsers commonly block
    // popups initiated AFTER awaiting an API response.
    const upworkTab = window.open("about:blank", "_blank");
    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}/submit`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        upworkTab?.close();
        setNotice(data.error ?? "Submission handoff failed");
        return;
      }
      if (data.status === "manual_required") {
        if (upworkTab && !upworkTab.closed) {
          upworkTab.opener = null;
          upworkTab.location.href = String(data.jobUrl);
          setNotice("Upwork opened. Submit the approved proposal there, then confirm here.");
        } else {
          setNotice("Pop-up blocked. Use Open original in the opportunity brief, submit in Upwork, then confirm here.");
        }
      } else {
        upworkTab?.close();
        setNotice("Submission was acknowledged by the authorized integration.");
      }
      router.refresh();
    } catch {
      upworkTab?.close();
      setNotice("Cannot verify submission. Check Upwork before trying again.");
    } finally { setPending(""); }
  }

  async function copyProposal() {
    if (!opportunity.proposal_body) return;
    try {
      await navigator.clipboard.writeText(opportunity.proposal_body);
      setNotice("Proposal copied. Review it in Upwork before submitting.");
    } catch {
      setNotice("Copy was blocked by the browser. Select the proposal text and copy it manually.");
    }
  }

  function resolveUncertainSubmission(outcome: "submitted" | "not_submitted") {
    const message = outcome === "submitted"
      ? "Confirm only if Upwork shows this proposal as submitted."
      : "Confirm only if Upwork shows that no proposal was submitted. Visez will return it to approved status.";
    if (window.confirm(message)) void action({ action: "resolve_submission", outcome });
  }

  return (
    <main>
      <header className="detail-header">
        <button className="back-button" onClick={() => router.push("/")}>← Back to opportunities</button>
        <div className="detail-topline"><span className={`status status-${opportunity.status}`}>{opportunity.status.replaceAll("_", " ")}</span><span>Detected {new Date(opportunity.created_at).toLocaleString()}</span></div>
        <div className="detail-title"><div><p className="eyebrow">UPWORK OPPORTUNITY</p><h1>{opportunity.title}</h1><p>{opportunity.client_name ?? "Upwork client"} {opportunity.client_location ? `· ${opportunity.client_location}` : ""}</p></div><div className="hero-score"><strong>{opportunity.score ?? "—"}</strong><span>FIT SCORE</span></div></div>
      </header>
      {notice && <div className="notice" role="status">{notice}</div>}
      {latestClientReply && <ReplyAssistant
        key={String(latestClientReply.id)}
        opportunityId={opportunity.id}
        messageId={String(latestClientReply.id)}
        messageBody={String(latestClientReply.body ?? "")}
        jobUrl={opportunity.job_url}
        roomUrl={latestClientReply.upwork_room_url ? String(latestClientReply.upwork_room_url) : null}
      />}

      <section className="detail-grid">
        <div className="detail-main">
          <article className="card proposal-card">
            <div className="card-heading"><div><p className="eyebrow">PROPOSAL PREVIEW</p><h2>Prepared for approval</h2></div>{opportunity.quality_score != null && <span className="qc-score">QC {opportunity.quality_score}/100</span>}</div>
            {opportunity.proposal_id && approvalIssues.some((issue) => issue.startsWith("Replace bracketed")) && <p className="notice" role="alert">
              The draft has unfinished proof or delivery notes. Replace them with verified information before approval.
            </p>}
            {missingOpening && opportunity.proposal_id && <p className="notice" role="alert">
              Client requires this proposal to start with <strong>“{requiredOpening}”</strong>. Edit the draft before approval.
            </p>}
            {!opportunity.proposal_id ? <div className="empty-state compact"><h3>No proposal prepared yet</h3><p>Opportunities below the auto-prepare threshold remain qualified for manual review.</p><button className="secondary-button" disabled={Boolean(pending)} onClick={() => action({ action: "rescore" })}>Score &amp; prepare now</button></div> : editing ? (
              <div className="proposal-editor">
                <label>Proposal<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={14} /></label>
                <div className="form-row"><label>Bid amount<input type="number" value={bidAmount} onChange={(event) => setBidAmount(Number(event.target.value))} /></label><label>Timeline<input value={timeline} onChange={(event) => setTimeline(event.target.value)} /></label></div>
                <label>Questions, one per line<textarea value={questions} onChange={(event) => setQuestions(event.target.value)} rows={4} /></label>
              </div>
            ) : (
              <div className="proposal-copy"><p>{opportunity.proposal_body}</p>{(opportunity.proposal_questions ?? []).length > 0 && <><h3>Questions for the client</h3><ol>{opportunity.proposal_questions!.map((question) => <li key={question}>{question}</li>)}</ol></>}</div>
            )}
            {opportunity.proposal_id && <div className="proposal-actions">
              {proposalLocked ? <p>Proposal locked after submission begins. No further edits or approvals permitted.</p> :
                editing ? <><button className="primary-button" disabled={Boolean(pending)} onClick={() => action({ action: "edit", body, bidAmount, timeline, questions: questions.split("\n").map((q) => q.trim()).filter(Boolean) })}>Save edits</button><button className="ghost-button" disabled={Boolean(pending)} onClick={() => setEditing(false)}>Cancel</button></> : <>
                <button className="primary-button" disabled={Boolean(pending) || opportunity.status === "approved"} onClick={() => action({ action: "approve" })}>{opportunity.status === "approved" ? "Approved" : "Approve proposal"}</button>
                <button className="secondary-button" disabled={Boolean(pending)} onClick={() => setEditing(true)}>Edit</button>
                {opportunity.status === "proposal_ready" && <button className="secondary-button" disabled={Boolean(pending)} onClick={() => action({ action: "rescore" })}>Refresh draft</button>}
                <button className="ghost-button danger" disabled={Boolean(pending)} onClick={() => action({ action: "reject", reason: "Rejected by Blair" })}>Reject</button>
              </>}
              {!editing && <><button className="secondary-button" disabled={Boolean(pending)} onClick={copyProposal}>Copy proposal</button><a className="secondary-button" href={opportunity.job_url} target="_blank" rel="noreferrer">Open Upwork job ↗</a></>}
            </div>}
          </article>

          <article className="card"><div className="card-heading"><div><p className="eyebrow">OPPORTUNITY BRIEF</p><h2>Client requirements</h2></div><a href={opportunity.job_url} target="_blank" rel="noreferrer">Open original ↗</a></div><div className="description-copy">{opportunity.description}</div>{opportunity.requirements?.length > 0 && <ul className="requirements-list">{opportunity.requirements.map((item) => <li key={item}>{item}</li>)}</ul>}</article>
          {messages.length > 0 && <article className="card"><div className="card-heading"><div><p className="eyebrow">CLIENT REPLIES</p><h2>Conversation updates</h2></div></div>{messages.map((message) => <div className="message" key={String(message.id)}><div><strong>{String(message.sender ?? "Client")}</strong><span>{new Date(String(message.received_at ?? message.created_at)).toLocaleString()}</span></div><p>{String(message.body)}</p></div>)}</article>}
        </div>

        <aside className="detail-side">
          <article className="card commercial-card"><p className="eyebrow">RECOMMENDED COMMERCIALS</p><div><small>{opportunity.budget_type === "hourly" ? "Hourly rate" : "Bid"}</small><strong>{money(opportunity.proposal_bid_amount ?? opportunity.suggested_bid)}{opportunity.budget_type === "hourly" ? "/hr" : ""}</strong></div><div><small>Timeline</small><strong>{opportunity.proposal_timeline ?? opportunity.suggested_timeline ?? "TBD"}</strong></div>{(opportunity.proposal_milestones ?? []).map((milestone) => <section key={milestone.name}><span>{milestone.name}</span><b>{money(milestone.amount)}{opportunity.budget_type === "hourly" ? "/hr" : ""}</b><p>{milestone.deliverable}</p></section>)}</article>
          <article className="card score-card"><p className="eyebrow">QUALIFICATION BREAKDOWN</p>{breakdown ? Object.entries(breakdown).filter(([key]) => key !== "reasons").map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><i><b style={{ width: `${Math.min(100, (Number(value) / (key === "serviceFit" ? 25 : key === "recurringRevenue" ? 10 : 15)) * 100)}%` }} /></i><strong>{String(value)}</strong></div>) : <p>Pending score</p>}</article>
          {opportunity.human_judgment_required && <article className="risk-card"><strong>Human judgment required</strong><p>The reviewer detected uncertainty or risk. Check the quality notes and edit before approval.</p></article>}
          <article className="card submit-card"><p className="eyebrow">SUBMISSION</p><h3>{opportunity.status === "approved" ? "Approved and ready" : opportunity.status === "ready_to_submit" ? "Manual submission ready" : opportunity.status === "submission_processing" ? "Verify status in Upwork" : "Approval required"}</h3><p>{opportunity.status === "submission_processing" ? "The result is uncertain. Check the Upwork job before choosing either outcome; Visez will never retry automatically." : "Submission uses the permitted integration when configured. Otherwise Visez opens the authenticated Upwork job for your final human-controlled action."}</p><button className="primary-button" disabled={!['approved','ready_to_submit'].includes(opportunity.status) || Boolean(pending)} onClick={submit}>{pending === "submit" ? "Preparing…" : "Continue to submission"}</button>{opportunity.status === "ready_to_submit" && <button className="secondary-button" disabled={Boolean(pending)} onClick={() => action({ action: "mark_submitted" })}>I submitted this bid</button>}{opportunity.status === "submission_processing" && <><button className="secondary-button" disabled={Boolean(pending)} onClick={() => resolveUncertainSubmission("submitted")}>Verified: submitted</button><button className="secondary-button" disabled={Boolean(pending)} onClick={() => resolveUncertainSubmission("not_submitted")}>Verified: not submitted</button></>}</article>
          {['submitted','replied','interviewed'].includes(opportunity.status) && <article className="card stage-actions"><p className="eyebrow">PIPELINE STAGE</p><div>{opportunity.status !== "interviewed" && <button onClick={() => action({ action: "set_stage", stage: "interviewed" })}>Interview</button>}<button onClick={() => action({ action: "set_stage", stage: "won" })}>Won</button><button onClick={() => action({ action: "set_stage", stage: "lost" })}>Lost</button></div></article>}
        </aside>
      </section>
    </main>
  );
}
