"use client";

import { useCallback, useEffect, useState } from "react";

type InboxEvent = {
  id: string;
  platform: string;
  kind: "comment" | "dm";
  category: string;
  replyText: string;
  receivedAt: string;
  status: "pending_review" | "approved_not_sent" | "rejected" | "suppressed";
  requiresReview: boolean;
  sendEnabled: false;
};

type InboxResponse = {
  brandId: string;
  authorizedInboxAccountRecords: number;
  externalProviderConnectionVerified: boolean;
  autoReplyEnabled: false;
  autoDmEnabled: false;
  outboundMessagesSent: 0;
  events: InboxEvent[];
  error?: string;
};

export function FlowInbox({ brandId, accessKey, previewMode }: {
  brandId: string;
  accessKey: string;
  previewMode: boolean;
}) {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = useCallback(() => ({
    "X-Brand-ID": brandId,
    "X-Upload-Key": accessKey,
  }), [brandId, accessKey]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (previewMode) return;
    const response = await fetch("/api/flow/engagement/inbox", { headers: headers(), signal });
    const body = await response.json() as InboxResponse;
    if (!response.ok) throw new Error(body.error || "Could not load brand inbox.");
    setData(body);
  }, [headers, previewMode]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((cause: Error) => {
      if (cause.name !== "AbortError") setError(cause.message);
    });
    return () => controller.abort();
  }, [refresh]);

  async function review(id: string, decision: "approved_not_sent" | "rejected") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/flow/engagement/inbox", {
        method: "PATCH",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Inbox review failed.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inbox review failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Inbound comments and message review">
    <div className="flow-engagement-list-head">
      <h2>Incoming comments &amp; DMs</h2>
      <button type="button" className="text-button" onClick={() => void refresh().catch((cause: Error) => setError(cause.message))}>Refresh</button>
    </div>
    <p className="flow-engagement-hint">
      Only messages to a connected, verified brand account can enter the inbox.
      Replies are suggested for review; approval never sends a message.
    </p>
    {previewMode ? <p className="flow-engagement-empty">Inbox unavailable in preview mode.</p> : <>
      {error && <p className="message error" role="alert">{error}</p>}
      {!data ? <p className="flow-engagement-empty">Loading review queue…</p> :
        data.events.length === 0 ? <p className="flow-engagement-empty">
          No incoming messages for this brand. Live inbox providers are not connected yet.
        </p> :
        <div className="flow-engagement-queue">
          {data.events.map((item) => <article className="flow-engagement-card" key={item.id}>
            <div className="flow-engagement-meta">
              <b>{item.platform.toUpperCase()} · {item.kind.toUpperCase()}</b>
              <span>{item.status.replaceAll("_", " ")}</span>
            </div>
            <p className="flow-engagement-context">
              Topic: {item.category.replaceAll("_", " ")} · Received {new Date(item.receivedAt).toLocaleDateString()}
            </p>
            {item.replyText ? <p className="flow-engagement-reply">{item.replyText}</p> :
              <p className="flow-engagement-context">No reply allowed or needed.</p>}
            {item.requiresReview && <div className="flow-engagement-actions">
              <button type="button" disabled={busy}
                onClick={() => void review(item.id, "approved_not_sent")}>Approve draft (do not send)</button>
              <button type="button" disabled={busy}
                onClick={() => void review(item.id, "rejected")}>Reject</button>
            </div>}
          </article>)}
        </div>}
      </>}
  </section>;
}
