"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";

type Channel = { id: string; name: string; displayName?: string; service: string };
type Result = { id: string; concept: string; caption: string; imageUrl: string; hostedMediaUrl?: string; mediaType?: "image" | "video"; motionStyle?: string | null; motionError?: string | null; channel: string; service: string; status: string; bufferStatus?: string | null; requestedDueAt?: string | null; dueAt?: string | null; timeZone?: string; error?: string };

function confirmedTime(result: Result) {
  if (!result.dueAt) return "";
  return formatTime(result.dueAt, result.timeZone);
}

function formatTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timeZone || "America/Toronto", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export default function Home() {
  const [key, setKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [timing, setTiming] = useState("auto");
  const [scheduleAt, setScheduleAt] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [campaignId, setCampaignId] = useState("");

  useEffect(() => {
    const hashKey = new URLSearchParams(location.hash.slice(1)).get("key");
    if (hashKey) { localStorage.setItem("atlasium-upload-key", hashKey); history.replaceState(null, "", location.pathname); }
    // The private key only exists in browser storage, so hydration initializes it here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(hashKey || localStorage.getItem("atlasium-upload-key") || "");
    setCampaignId(localStorage.getItem("atlasium-active-campaign") || "");
  }, []);

  useEffect(() => {
    if (!key) return;
    fetch("/api/channels", { headers: { "X-Upload-Key": key } }).then(async (response) => {
      const data = await response.json() as { channels?: Channel[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load Buffer channels.");
      setChannels(data.channels || []);
    }).catch((error: Error) => setStatus({ kind: "error", text: error.message }));
  }, [key]);

  useEffect(() => {
    if (!key || !campaignId) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/campaign/${encodeURIComponent(campaignId)}`, { headers: { "X-Upload-Key": key } });
        const data = await response.json() as { message?: string; error?: string; results?: Result[]; processing?: boolean };
        if (!response.ok) throw new Error(data.error || "Could not refresh campaign progress.");
        if (stopped) return;
        setResults(data.results || []);
        setStatus({ kind: data.results?.some((result) => result.status === "FAILED") ? "error" : "ok", text: data.message || "Campaign progress updated." });
        if (!data.processing) { localStorage.removeItem("atlasium-active-campaign"); setCampaignId(""); }
      } catch (error) { if (!stopped) setStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh campaign progress." }); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 6000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [campaignId, key]);

  async function createAndPublish() {
    if (busy) return;
    if (!key) { setStatus({ kind: "error", text: "Open your private Atlasium link to enable publishing." }); return; }
    if (!prompt.trim()) { setStatus({ kind: "error", text: "Enter a campaign prompt first." }); return; }
    if (!channels.length) { setStatus({ kind: "error", text: "Buffer channels are still loading. Try again in a moment." }); return; }
    setBusy(true); setStatus(null); setResults([]);
    try {
      if (timing === "schedule" && !scheduleAt) throw new Error("Choose the exact date and time to schedule.");
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Key": key }, body: JSON.stringify({ prompt: prompt.trim(), channels: selected, timing, selectedLocalTime: timing === "schedule" ? scheduleAt : undefined, timeZone: "America/Toronto" }) });
      const data = await response.json() as { campaignId?: string; message?: string; error?: string; results?: Result[] };
      if (!response.ok) throw new Error(data.error || "Campaign creation failed.");
      const returnedResults = data.results || [];
      setResults(returnedResults);
      if (data.campaignId && returnedResults.some((result) => result.status === "PROCESSING MOTION")) { localStorage.setItem("atlasium-active-campaign", data.campaignId); setCampaignId(data.campaignId); }
      setStatus({ kind: returnedResults.some((result) => result.status === "FAILED") ? "error" : "ok", text: data.message || "Campaign sent to Buffer." });
    } catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "Campaign creation failed." }); }
    finally { setBusy(false); }
  }

  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  return <main>
    <header className="brand"><span className="brand-mark">A</span><span>ATLASIUM</span><span className="bridge">SOCIAL AGENT</span></header>
    <section className="card agent-card">
      <p className="eyebrow">ONE PROMPT → PUBLISHED</p>
      <h1>What should<br />we create?</h1>
      <p className="lede">Describe the campaign. Atlasium writes the posts, creates and hosts the images, chooses sensible times, and sends everything to Buffer.</p>
      <textarea className="prompt-box" rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Create 4 social posts about our new Atlasium offer and schedule them this week." aria-label="Campaign prompt" />

      <details className="options">
        <summary>Options <span>{selected.length ? `${selected.length} chosen` : "auto channels"} · {timing === "auto" ? "automatic timing" : timing}</span></summary>
        <div className="option-block"><span className="option-label">Channels</span><div className="channels compact">
          {channels.map((channel) => <button type="button" key={channel.id} className={selected.includes(channel.id) ? "selected" : ""} onClick={() => toggle(channel.id)}><span className="channel-icon">{channel.service[0]?.toUpperCase()}</span><span><b>{channel.displayName || channel.name}</b><small>{channel.service}</small></span><i>{selected.includes(channel.id) ? "✓" : ""}</i></button>)}
          {!channels.length ? <p className="empty">Your Buffer channels load automatically from your private link.</p> : <p className="empty">Leave all unselected and the prompt will choose. Select channels to override.</p>}
        </div></div>
        <div className="option-block"><span className="option-label">Timing</span><div className="timing">{[["auto","From prompt / Auto"],["now","Post now"],["queue","Buffer queue"],["schedule","Exact date/time"]].map(([value,label]) => <button type="button" key={value} className={timing === value ? "active" : ""} onClick={() => setTiming(value)}>{label}</button>)}</div></div>
        {timing === "schedule" && <div className="option-block"><label className="option-label" htmlFor="schedule-at">Exact Toronto date and time</label><input id="schedule-at" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></div>}
      </details>

      {status && <p className={`message ${status.kind}`} role="status">{status.kind === "ok" ? "✓ " : "! "}{status.text}</p>}
      <button className="primary agent-button" disabled={busy} onClick={createAndPublish}>{busy ? <><span className="spinner" /> Creating campaign…</> : campaignId ? <><span className="spinner" /> Processing motion…</> : <>Create &amp; Publish <span>→</span></>}</button>
      {!key && <p className="access-warning">Open your private Atlasium link to enable publishing.</p>}
    </section>

    {results.length > 0 && <section className="results"><div className="results-head"><p className="eyebrow">BUFFER RESULTS</p><h2>Confirmed campaign status</h2></div>{results.map((result) => <article className={`result ${result.status === "FAILED" ? "failed" : ""}`} key={result.id}>{result.mediaType === "video" && result.hostedMediaUrl ? <video src={result.hostedMediaUrl} poster={result.imageUrl} controls playsInline muted style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: ".7rem" }} /> : <img src={result.imageUrl} alt="Generated social media creative" />}<div><span className="result-status">{result.status} · {result.mediaType === "video" ? "MOTION VIDEO" : "STATIC IMAGE"}</span><h3>{result.concept}</h3><p>{result.caption}</p><small>{result.service} · {result.channel}{confirmedTime(result) ? ` · ${confirmedTime(result)}` : ""}{result.bufferStatus ? ` · Buffer: ${result.bufferStatus}` : ""}</small>{result.motionError && <p className="result-error">Motion fallback: {result.motionError}</p>}{result.error && <p className="result-error">{result.error}{result.requestedDueAt ? ` Requested: ${formatTime(result.requestedDueAt, result.timeZone)}.` : ""}</p>}</div></article>)}</section>}

    <details className="manual-link"><summary>Need the manual uploader?</summary><p>The original upload and permanent-public-URL API remains active as a secondary fallback.</p></details>
    <footer>OpenAI and Buffer credentials stay encrypted on the server.</footer>
  </main>;
}
