"use client";

import { useMemo, useState } from "react";
import { buildEngagementTrackingLink, engagementSources, type EngagementSource } from "../services/engagement-tracking";

export function FlowTrafficLinks({ website }: { website: string }) {
  const [platform, setPlatform] = useState<EngagementSource>("linkedin");
  const [campaign, setCampaign] = useState("owner-conversations");
  const [content, setContent] = useState("");
  const [path, setPath] = useState("/");
  const [copyState, setCopyState] = useState("");
  const built = useMemo(() => {
    if (!website) return { link: "", error: "Add this brand's website in EchoFlow before preparing campaign links." };
    try {
      return { link: buildEngagementTrackingLink({ website, platform, campaign, content, path }), error: "" };
    } catch (error) {
      return { link: "", error: error instanceof Error ? error.message : "Could not build tracking link." };
    }
  }, [website, platform, campaign, content, path]);

  async function copy() {
    setCopyState("");
    if (!built.link) return;
    try {
      await navigator.clipboard.writeText(built.link);
      setCopyState("Link copied. Use it in an approved brand post or reply.");
    } catch {
      setCopyState("Clipboard unavailable; select and copy the URL from the field.");
    }
  }

  return <section className="flow-engagement-form" aria-label="Organic social traffic links">
    <h2>Traffic link builder</h2>
    <p>Create a branded tracking link for an approved post or campaign. This identifies the source in your website analytics; it does not itself track visitors or sales.</p>
    <div className="flow-engagement-fields">
      <label>Social platform<select value={platform} onChange={(event) => setPlatform(event.target.value as EngagementSource)}>
        {engagementSources.map((name) => <option value={name} key={name}>{name.toUpperCase()}</option>)}
      </select></label>
      <label>Campaign label<input type="text" maxLength={64} value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="owner-conversations" /></label>
    </div>
    <div className="flow-engagement-fields">
      <label>Website page (path only)<input type="text" value={path} onChange={(event) => setPath(event.target.value)}
        placeholder="/article-name" /></label>
      <label>Post identifier (optional)<input type="text" maxLength={64} value={content}
        onChange={(event) => setContent(event.target.value)} placeholder="week01-owner-question" /></label>
    </div>
    {built.error ? <p role="status" className="flow-engagement-link-hint">{built.error}</p> :
      <label>Brand-owned tracking URL<input type="text" readOnly value={built.link} onFocus={(event) => event.currentTarget.select()} /></label>}
    <button type="button" disabled={!built.link} onClick={() => void copy()}>Copy tracking URL</button>
    {copyState && <p role="status" className="flow-engagement-link-hint">{copyState}</p>}
  </section>;
}
