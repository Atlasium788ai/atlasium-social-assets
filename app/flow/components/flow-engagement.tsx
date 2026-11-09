"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FlowInbox } from "./flow-inbox";
import { FlowTrafficLinks } from "./flow-traffic-links";

type Platform = "instagram" | "facebook" | "linkedin" | "threads" | "tiktok" | "youtube" | "x";
type EngagementDraft = {
  id: string;
  platform: Platform;
  sourceKind: string;
  sourceUrl: string;
  context: string;
  suggestedReply: string;
  status: "pending_review" | "approved_not_sent" | "rejected";
  createdAt: string;
  manualConfirmedAt: string | null;
  manualConfirmationOnly: boolean;
  sendEnabled: false;
};
type EngagementResponse = {
  brandId: string;
  providerInboxConnected: false;
  externalCommentScannerConnected: false;
  autoCommentEnabled: false;
  autoDmEnabled: false;
  outboundMessagesSent: number;
  drafts: EngagementDraft[];
  metrics?: {
    pendingReview: number;
    approvedWaitingManual: number;
    manuallyConfirmedSelfReported: number;
    providerVerifiedPublications: number;
  };
  error?: string;
};

const platforms: readonly Platform[] = ["instagram", "facebook", "linkedin", "threads", "tiktok", "youtube", "x"];

export function FlowEngagement({ accessKey, brandId, previewMode, website }: { accessKey: string; brandId: string; previewMode: boolean; website: string }) {
  const [data, setData] = useState<EngagementResponse | null>(null);
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [sourceUrl, setSourceUrl] = useState("");
  const [context, setContext] = useState("");
  const [suggestedReply, setSuggestedReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const headers = useCallback(() => ({ "X-Brand-ID": brandId, "X-Upload-Key": accessKey }), [brandId, accessKey]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (previewMode) { setData(null); return; }
    const response = await fetch("/api/flow/engagement", { headers: headers(), signal });
    const payload = await response.json() as EngagementResponse;
    if (!response.ok) throw new Error(payload.error || "Could not load engagement drafts.");
    setData(payload);
  }, [headers, previewMode]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((cause: Error) => {
      if (cause.name !== "AbortError") setError(cause.message);
    });
    return () => controller.abort();
  }, [refresh]);

  async function generateReply() {
    if (!context.trim() || !sourceUrl.trim()) return;
    setGenerating(true); setError("");
    try {
      const response = await fetch("/api/flow/engagement/suggest", {
        method: "POST", headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ platform, sourceUrl, context }),
      });
      const result = await response.json() as { suggestedReply?: string; error?: string };
      if (!response.ok || !result.suggestedReply)
        throw new Error(result.error || "Could not generate a reply suggestion.");
      setSuggestedReply(result.suggestedReply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate a reply suggestion.");
    } finally { setGenerating(false); }
  }

  async function addDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/flow/engagement", {
        method: "POST", headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ platform, sourceUrl, context, suggestedReply }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not add engagement opportunity.");
      setSourceUrl(""); setContext(""); setSuggestedReply("");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save draft."); }
    finally { setBusy(false); }
  }

  async function copyReply(reply: string) {
    setError(""); setActionMessage("");
    try {
      await navigator.clipboard.writeText(reply);
      setActionMessage("Reply copied. Open the original conversation and post it using the selected brand account.");
    } catch {
      setError("Clipboard access is unavailable. Select and copy the reply text manually.");
    }
  }

  async function confirmManualPosting(id: string) {
    if (!window.confirm("Confirm you personally posted this reply from the correct brand account. EchoFlow cannot verify the post.")) return;
    setBusy(true); setError(""); setActionMessage("");
    try {
      const response = await fetch("/api/flow/engagement/manual-confirm", {
        method: "POST", headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ id, confirmation: "I_POSTED_THIS_MANUALLY" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not confirm manual posting.");
      setActionMessage("Recorded as manually posted. This is self-reported, not verified by the social platform.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm manual posting.");
    } finally { setBusy(false); }
  }

  async function decide(id: string, decision: "approved_not_sent" | "rejected") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/flow/engagement", {
        method: "PATCH", headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not review opportunity.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review opportunity."); }
    finally { setBusy(false); }
  }

  return <section className="flow-engagement" aria-label="Brand engagement review">
    <div className="flow-engagement-head">
      <div><p className="eyebrow">FLOW / SHARED SOCIAL GROWTH</p><h1>Engagement</h1>
        <p>One brand-scoped place to prepare helpful conversations, comment replies and opt-in message flows.</p></div>
      <span className="flow-engagement-state">REVIEW ONLY · NO AUTOMATIC SEND</span>
    </div>

    <div className="flow-engagement-notice" role="status">
      <strong>Social inbox and external scanning are not connected.</strong>
      <span>We can prepare individual responses here. Nothing will comment on another page or DM anyone until supported accounts are authorized and delivery is tested.</span>
    </div>

    {previewMode ? <div className="flow-engagement-empty"><p>Local preview mode: no live brand records or social connections.</p></div> : <>
      {error && <p className="message error" role="alert">! {error}</p>}
      {actionMessage && <p className="flow-engagement-notice" role="status">{actionMessage}</p>}
      <FlowInbox brandId={brandId} accessKey={accessKey} previewMode={previewMode} />
      <FlowTrafficLinks website={website} />
      <form className="flow-engagement-form" onSubmit={addDraft}>
        <h2>Add a conversation opportunity</h2>
        <p>Manually selected public discussions only. Do not paste private messages or personal contact details.</p>
        <div className="flow-engagement-fields">
          <label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
            {platforms.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}
          </select></label>
          <label>Public post URL<input type="url" required placeholder="https://..." maxLength={2048} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label>
        </div>
        <label>Conversation context<textarea rows={2} required maxLength={500} placeholder="What question is being discussed?" value={context} onChange={(event) => setContext(event.target.value)} /></label>
        <div className="flow-engagement-generate">
          <span>Use EchoFlow AI to prepare a reply from the context you provided. Nothing is sent or saved automatically.</span>
          <button type="button" disabled={busy || generating || !context.trim() || !sourceUrl.trim()}
            onClick={() => void generateReply()}>{generating ? "Drafting…" : "Suggest reply with AI"}</button>
        </div>
        <label>Helpful draft comment<textarea rows={3} required maxLength={600} placeholder="A specific, useful contribution. No solicitation." value={suggestedReply} onChange={(event) => setSuggestedReply(event.target.value)} /></label>
        <button className="action-button" type="submit" disabled={busy || generating}>{busy ? "Saving…" : "Save for review"}</button>
      </form>

      {data?.metrics && <section className="flow-engagement-summary" aria-label="Manual engagement activity">
        <div><strong>{data.metrics.pendingReview}</strong><span>Awaiting review</span></div>
        <div><strong>{data.metrics.approvedWaitingManual}</strong><span>Ready for manual posting</span></div>
        <div><strong>{data.metrics.manuallyConfirmedSelfReported}</strong><span>Manually confirmed</span></div>
        <small>Operator-reported actions. No automatic or provider-verified posts.</small>
      </section>}
      <div className="flow-engagement-list-head"><h2>Review queue</h2><button type="button" className="text-button" onClick={() => void refresh().catch((e: Error) => setError(e.message))}>Refresh</button></div>
      {!data ? <p className="flow-engagement-empty">Loading brand engagement queue…</p> : data.drafts.length === 0 ?
        <p className="flow-engagement-empty">No engagement opportunities have been saved for this brand.</p> :
        <div className="flow-engagement-queue">{data.drafts.map((item) => <article className="flow-engagement-card" key={item.id}>
          <div className="flow-engagement-meta"><b>{item.platform.toUpperCase()}</b><span>{item.status.replaceAll("_", " ")}</span></div>
          <p className="flow-engagement-context">{item.context}</p>
          <p className="flow-engagement-reply">{item.suggestedReply}</p>
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-button">View original conversation ↗</a>
          {item.status === "pending_review" && <div className="flow-engagement-actions">
            <button type="button" disabled={busy} onClick={() => void decide(item.id, "approved_not_sent")}>Approve draft (do not send)</button>
            <button type="button" disabled={busy} onClick={() => void decide(item.id, "rejected")}>Reject</button>
          </div>}
          {item.status === "approved_not_sent" && !item.manualConfirmedAt && <div className="flow-engagement-actions">
            <button type="button" disabled={busy} onClick={() => void copyReply(item.suggestedReply)}>Copy approved reply</button>
            <button type="button" disabled={busy} onClick={() => void confirmManualPosting(item.id)}>I posted it manually</button>
          </div>}
          {item.manualConfirmedAt && <p className="flow-engagement-context">
            Manually confirmed on {new Date(item.manualConfirmedAt).toLocaleDateString()}. Not verified by provider.
          </p>}
        </article>)}</div>
      }
    </>}
  </section>;
}
