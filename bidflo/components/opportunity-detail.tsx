"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReplyAssistant } from "@/components/reply-assistant";
import { requiredProposalOpening, proposalApprovalIssues } from "@/lib/application-rules";
import { getProposalChecks } from "@/lib/proposal-checks";
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
  const [nurtureNote, setNurtureNote] = useState(opportunity.nurture_note ?? "");
  const [nurtureDue, setNurtureDue] = useState(String(opportunity.nurture_due_at ?? "").slice(0, 10));
  const [nurtureDraft, setNurtureDraft] = useState("Hi, I wanted to check in with a useful update from Atlasium. If you have any CRM, automation, or sales workflow projects where we can support you, I'd be glad to discuss them here on Upwork. If you'd prefer no occasional follow-ups, just reply STOP and we'll respect that.");
  const clientRoom = messages.find((message) => message.upwork_room_url && /^https:\/\/(?:www\.)?upwork\.com\/ab\/messages\/rooms\//i.test(String(message.upwork_room_url)))?.upwork_room_url;
  const contactStopped = Boolean(opportunity.opted_out_at) || opportunity.status === "opted_out";
  const breakdown = opportunity.score_breakdown as ScoreBreakdown | null;
  const requiredOpening = requiredProposalOpening(opportunity.description);
  const currentProposal = editing ? body : String(opportunity.proposal_body ?? "");
  const approvalIssues = proposalApprovalIssues(opportunity.description, currentProposal);
  const proposalChecks = getProposalChecks({
    score: opportunity.score,
    bidAmount,
    budgetMax: opportunity.budget_max == null ? null : Number(opportunity.budget_max),
    timeline,
    proposalStatus: opportunity.proposal_status,
    humanJudgmentRequired: Boolean(opportunity.human_judgment_required),
    approvalIssues,
  });
  const allChecksPassed = proposalChecks.every((check) => check.state === "pass");
  const qualityIssues = Array.isArray(opportunity.quality_review?.issues)
    ? opportunity.quality_review.issues.filter((issue): issue is string => typeof issue === "string" && issue.trim().length > 0).slice(0, 6)
    : [];
  const missingOpening = Boolean(requiredOpening) && approvalIssues.some((issue) => issue.startsWith("Start the proposal"));
  const latestClientReply = messages.find((message) => message.direction === "inbound" && message.kind === "client_reply");
  const proposalLocked = ["ready_to_submit", "submission_processing", "submitted", "replied", "interviewed", "won", "nurture", "opted_out", "lost"].includes(opportunity.status);

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

  async function copyFulfilmentBrief() {
    const milestones = (opportunity.proposal_milestones ?? [])
      .map((milestone, index) => `${index + 1}. ${milestone.name}: ${milestone.deliverable} (${money(milestone.amount)})`)
      .join("\n");
    const clientQuestions = (opportunity.proposal_questions ?? []).map((question) => `- ${question}`).join("\n");
    const brief = [
      "ATLASIUM FULFILMENT BRIEF",
      `Opportunity: ${opportunity.title}`,
      `Client: ${opportunity.client_name ?? "Upwork client"}`,
      `Source: ${opportunity.job_url}`,
      `Approved bid package: ${money(opportunity.proposal_bid_amount ?? opportunity.suggested_bid)}`,
      `Delivery window: ${opportunity.proposal_timeline ?? opportunity.suggested_timeline ?? "Confirm during scoping"}`,
      "", "CLIENT REQUIREMENTS", opportunity.description,
      "", "PROPOSED DELIVERY MILESTONES", milestones || "Confirm milestones during scoping.",
      "", "OPEN QUESTIONS", clientQuestions || "No open questions recorded.",
      "", "FULFILMENT RULES",
      "Confirm specialist availability, delivery cost, access requirements and scope before any client commitment. Do not invent experience, results, certifications or availability.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(brief);
      setNotice("Fulfilment brief copied. Paste it into the approved Atlasium fulfilment chat or workflow.");
    } catch {
      setNotice("Copy was blocked by the browser. Please retry from a secure browser tab.");
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
      {contactStopped && <div className="notice" role="status"><strong>Client requested no further contact.</strong> Nurturing is disabled. The request remains on record.</div>}
      {latestClientReply && !contactStopped && <ReplyAssistant
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
            {opportunity.proposal_id && <section className="proposal-checks" aria-label="Three-check proposal gate">
              <div><p className="eyebrow">3-CHECK PROPOSAL GATE</p><h3>One quick decision.</h3></div>
              <ol>{proposalChecks.map((check, index) => <li className={`check-${check.state}`} key={check.label}>
                <span>{check.state === "pass" ? "✓" : check.state === "review" ? "!" : "…"}</span>
                <div><strong>{index + 1}. {check.label}</strong><small>{check.detail}</small></div>
              </li>)}</ol>
              <p className="proposal-next-action"><strong>Next:</strong> {allChecksPassed ? "Review once, then approve." : "Fix or confirm the highlighted item, then approve."}</p>
            </section>}
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
            {opportunity.proposal_id && <section className="bid-package" aria-label="Complete approval package">
              <div><p className="eyebrow">COMPLETE BID PACKAGE</p><h3>Ready for one review.</h3></div>
              <div className="bid-package-grid">
                <span><strong>Proposal</strong><small>Client-specific draft</small></span>
                <span><strong>{(opportunity.proposal_questions ?? []).length}</strong><small>Screening questions</small></span>
                <span><strong>{(opportunity.proposal_milestones ?? []).length}</strong><small>Priced milestones</small></span>
                <span><strong>{(opportunity.attachment_recommendations ?? []).length}</strong><small>Relevant attachments</small></span>
              </div>
              {(opportunity.attachment_recommendations ?? []).length > 0 && <div className="bid-attachments">
                {(opportunity.attachment_recommendations ?? []).map((attachment) => <article key={attachment.id}>
                  <div><strong>{attachment.name}</strong><p>{attachment.reason}. {attachment.description}</p></div>
                  <a className="secondary-button" href={attachment.href}>Download PDF</a>
                </article>)}
                <p>Use only when relevant to this job. Review the file, then attach it during the approved Upwork submission.</p>
              </div>}
              <button className="secondary-button" type="button" onClick={() => void copyFulfilmentBrief()}>Copy fulfilment brief</button>
            </section>}
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
          <article className="card commercial-card"><p className="eyebrow">RECOMMENDED COMMERCIALS</p><div><small>{opportunity.budget_type === "hourly" ? "Hourly rate" : "Bid"}</small><strong>{money(opportunity.proposal_bid_amount ?? opportunity.suggested_bid)}{opportunity.budget_type === "hourly" ? "/hr" : ""}</strong></div><div><small>Timeline</small><strong>{opportunity.proposal_timeline ?? opportunity.suggested_timeline ?? "TBD"}</strong></div><div><small>Profitability fit</small><strong>{breakdown ? `${breakdown.profitability}/15` : "Pending"}</strong></div><div><small>Submitting account</small><strong>Confirm in Upwork</strong></div><div><small>Connects required</small><strong>Verified in Upwork</strong></div>{(opportunity.proposal_milestones ?? []).map((milestone) => <section key={milestone.name}><span>{milestone.name}</span><b>{money(milestone.amount)}{opportunity.budget_type === "hourly" ? "/hr" : ""}</b><p>{milestone.deliverable}</p></section>)}</article>
          <article className="card score-card"><p className="eyebrow">QUALIFICATION BREAKDOWN</p>{breakdown ? Object.entries(breakdown).filter(([key]) => key !== "reasons").map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><i><b style={{ width: `${Math.min(100, (Number(value) / (key === "serviceFit" ? 25 : key === "recurringRevenue" ? 10 : 15)) * 100)}%` }} /></i><strong>{String(value)}</strong></div>) : <p>Pending score</p>}</article>
          {opportunity.human_judgment_required && <article className="risk-card"><strong>Human judgment required</strong><p>Review these items before approval.</p>{qualityIssues.length > 0 && <ul>{qualityIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</article>}
          <article className="card submit-card"><p className="eyebrow">SUBMISSION</p><h3>{opportunity.status === "approved" ? "Approved and ready" : opportunity.status === "ready_to_submit" ? "Manual submission ready" : opportunity.status === "submission_processing" ? "Verify status in Upwork" : "Approval required"}</h3><p>{opportunity.status === "submission_processing" ? "The result is uncertain. Check the Upwork job before choosing either outcome; Visez will never retry automatically." : "Submission uses the permitted integration when configured. Otherwise Visez opens the authenticated Upwork job for your final human-controlled action."}</p><button className="primary-button" disabled={!['approved','ready_to_submit'].includes(opportunity.status) || Boolean(pending)} onClick={submit}>{pending === "submit" ? "Preparing…" : "Continue to submission"}</button>{opportunity.status === "ready_to_submit" && <button className="secondary-button" disabled={Boolean(pending)} onClick={() => action({ action: "mark_submitted" })}>I submitted this bid</button>}{opportunity.status === "submission_processing" && <><button className="secondary-button" disabled={Boolean(pending)} onClick={() => resolveUncertainSubmission("submitted")}>Verified: submitted</button><button className="secondary-button" disabled={Boolean(pending)} onClick={() => resolveUncertainSubmission("not_submitted")}>Verified: not submitted</button></>}</article>
          {['submitted','replied','interviewed','nurture'].includes(opportunity.status) && !contactStopped && <article className="card stage-actions">
            <p className="eyebrow">RELATIONSHIP STAGE</p>
            <div>
              {opportunity.status === "nurture" && <button disabled={Boolean(pending)} onClick={() => action({ action: "set_stage", stage: "replied" })}>Back to Follow Up</button>}
              {opportunity.status !== "interviewed" && opportunity.status !== "nurture" && <button disabled={Boolean(pending)} onClick={() => action({ action: "set_stage", stage: "interviewed" })}>Interview</button>}
              <button disabled={Boolean(pending)} onClick={() => action({ action: "set_stage", stage: "won" })}>Won</button>
              <button disabled={Boolean(pending)} onClick={() => action({ action: "set_stage", stage: "lost" })}>Lost</button>
              {opportunity.status !== "nurture" && <button disabled={Boolean(pending)} onClick={() => action({ action: "set_stage", stage: "nurture" })}>Move to Nurture</button>}
            </div>
            <p>Use Lost only when the outcome is known. Client opt-outs remain separate and stop future contact.</p>
          </article>}
          {opportunity.status === "nurture" && !contactStopped && <article className="card visez-nurture-card">
            <p className="eyebrow">NURTURE · HUMAN-REVIEWED</p><h3>Build the relationship</h3>
            <label>Relationship note<textarea rows={4} value={nurtureNote} onChange={(e) => setNurtureNote(e.target.value)} maxLength={2000} placeholder="Last conversation, needs and next helpful update"/></label>
            <label>Next reminder<input type="date" value={nurtureDue} onChange={(e) => setNurtureDue(e.target.value)} /></label>
            <button className="primary-button" disabled={Boolean(pending)} onClick={() => action({ action: "update_nurture", note: nurtureNote, dueDate: nurtureDue || null })}>Save nurture plan</button>
            <label>Suggested Upwork message<textarea rows={6} value={nurtureDraft} onChange={(e) => setNurtureDraft(e.target.value)} /></label>
            <button className="secondary-button" onClick={async () => { try { await navigator.clipboard.writeText(nurtureDraft); setNotice("Draft copied. Review and send only through an existing Upwork conversation."); } catch { setNotice("Copy blocked by browser."); } }}>Copy message draft</button>
            {clientRoom ? <a className="secondary-button" href={String(clientRoom)} target="_blank" rel="noreferrer">Open existing Upwork conversation ↗</a> : <p>Upwork conversation link not connected. Do not send unsolicited direct messages.</p>}
            <p>Only the client can request no further updates by replying STOP. Messages are never sent automatically.</p>
          </article>}
        </aside>
      </section>
    </main>
  );
}
