"use client";

import { useEffect, useState } from "react";

type Channel = { id: string; name: string; displayName?: string; service: string };
type Result = { concept: string; caption: string; imageUrl: string; channel: string; service: string; status: string; dueAt?: string };

export default function Home() {
  const [key, setKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [timing, setTiming] = useState("auto");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    const hashKey = new URLSearchParams(location.hash.slice(1)).get("key");
    if (hashKey) { localStorage.setItem("atlasium-upload-key", hashKey); history.replaceState(null, "", location.pathname); }
    // The private key only exists in browser storage, so hydration initializes it here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(hashKey || localStorage.getItem("atlasium-upload-key") || "");
  }, []);

  useEffect(() => {
    if (!key) return;
    fetch("/api/channels", { headers: { "X-Upload-Key": key } }).then(async (response) => {
      const data = await response.json() as { channels?: Channel[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load Buffer channels.");
      setChannels(data.channels || []);
    }).catch((error: Error) => setStatus({ kind: "error", text: error.message }));
  }, [key]);

  async function createAndPublish() {
    if (!prompt.trim() || !selected.length || busy) return;
    setBusy(true); setStatus(null); setResults([]);
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Key": key }, body: JSON.stringify({ prompt: prompt.trim(), channels: selected, timing, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      const data = await response.json() as { message?: string; error?: string; results?: Result[] };
      if (!response.ok) throw new Error(data.error || "Campaign creation failed.");
      setResults(data.results || []); setStatus({ kind: "ok", text: data.message || "Campaign sent to Buffer." });
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
        <div className="option-block"><span className="option-label">Timing</span><div className="timing">{[["auto","From prompt / Auto"],["now","Post now"],["queue","Buffer queue"],["schedule","Auto-schedule"]].map(([value,label]) => <button type="button" key={value} className={timing === value ? "active" : ""} onClick={() => setTiming(value)}>{label}</button>)}</div></div>
      </details>

      {status && <p className={`message ${status.kind}`} role="status">{status.kind === "ok" ? "✓ " : "! "}{status.text}</p>}
      <button className="primary agent-button" disabled={!key || !prompt.trim() || !channels.length || busy} onClick={createAndPublish}>{busy ? <><span className="spinner" /> Creating campaign…</> : <>Create &amp; Publish <span>→</span></>}</button>
      {!key && <p className="access-warning">Open your private Atlasium link to enable publishing.</p>}
    </section>

    {results.length > 0 && <section className="results"><div className="results-head"><p className="eyebrow">CAMPAIGN COMPLETE</p><h2>What was created</h2></div>{results.map((result, index) => <article className="result" key={`${result.channel}-${index}`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={result.imageUrl} alt="Generated social media creative" /><div><span className="result-status">{result.status}</span><h3>{result.concept}</h3><p>{result.caption}</p><small>{result.service} · {result.channel}{result.dueAt ? ` · ${new Date(result.dueAt).toLocaleString()}` : ""}</small></div></article>)}</section>}

    <details className="manual-link"><summary>Need the manual uploader?</summary><p>The original upload and permanent-public-URL API remains active as a secondary fallback.</p></details>
    <footer>OpenAI and Buffer credentials stay encrypted on the server.</footer>
  </main>;
}
