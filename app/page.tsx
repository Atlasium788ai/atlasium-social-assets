"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Channel = { id: string; name: string; displayName?: string; service: string; avatar?: string };
type Mode = "shareNow" | "addToQueue" | "customScheduled";

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [caption, setCaption] = useState("");
  const [notes, setNotes] = useState("");
  const [refine, setRefine] = useState(false);
  const [mode, setMode] = useState<Mode>("addToQueue");
  const [dueAt, setDueAt] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [platform, setPlatform] = useState("all");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    const hashKey = new URLSearchParams(location.hash.slice(1)).get("key");
    if (hashKey) {
      localStorage.setItem("atlasium-upload-key", hashKey);
      history.replaceState(null, "", location.pathname);
    }
    setKey(hashKey || localStorage.getItem("atlasium-upload-key") || "");
  }, []);

  useEffect(() => {
    if (!key) return;
    fetch("/api/channels", { headers: { "X-Upload-Key": key } })
      .then(async (response) => {
        const data = await response.json() as { channels?: Channel[]; configured?: boolean; error?: string };
        setConfigured(Boolean(data.configured));
        if (!response.ok) throw new Error(data.error || "Could not load Buffer channels.");
        setChannels(data.channels || []);
      })
      .catch((error: Error) => setStatus({ kind: "error", text: error.message }));
  }, [key]);

  const platforms = useMemo(() => [...new Set(channels.map((channel) => channel.service))], [channels]);
  const shownChannels = platform === "all" ? channels : channels.filter((channel) => channel.service === platform);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    setStatus(null);
    if (!next) return;
    if (!next.type.startsWith("image/") || next.size > 20 * 1024 * 1024) {
      setStatus({ kind: "error", text: "Choose an image under 20 MB." });
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }

  function toggleChannel(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function publish() {
    if (!file || !caption.trim() || !selected.length || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("caption", caption.trim());
      form.append("notes", notes.trim());
      form.append("channels", JSON.stringify(selected));
      form.append("refine", String(refine));
      form.append("mode", mode);
      if (mode === "customScheduled") form.append("dueAt", new Date(dueAt).toISOString());
      const response = await fetch("/api/publish", { method: "POST", headers: { "X-Upload-Key": key }, body: form });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Publishing failed.");
      setStatus({ kind: "ok", text: data.message || "Sent to Buffer successfully." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Publishing failed." });
    } finally { setBusy(false); }
  }

  const ready = Boolean(key && configured && file && caption.trim() && selected.length && (mode !== "customScheduled" || dueAt));

  return (
    <main>
      <header className="brand"><span className="brand-mark">A</span><span>ATLASIUM</span><span className="bridge">PUBLISH BRIDGE</span></header>
      <section className="card composer">
        <div className="intro"><p className="eyebrow">ONE-SCREEN PUBLISHING</p><h1>Create once.<br />Publish everywhere.</h1></div>

        <div className="section-grid">
          <section className="field-section media-section">
            <span className="step">01</span><label>Image</label>
            <input ref={inputRef} className="visually-hidden" type="file" accept="image/*" onChange={choose} />
            <button className={`mini-picker ${preview ? "has-image" : ""}`} type="button" onClick={() => inputRef.current?.click()}>
              {preview ? <img src={preview} alt="Selected post" /> : <span><b>＋</b>Choose from Photos</span>}
            </button>
          </section>

          <section className="field-section">
            <span className="step">02</span><label htmlFor="caption">Post</label>
            <textarea id="caption" rows={5} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Paste your finished post…" />
            <label className="sub-label" htmlFor="notes">Optional notes</label>
            <textarea id="notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Tone, constraints, hashtags…" />
            <label className="switch-row"><span><b>Refine with Claude</b><small>Adapt only where each platform needs it</small></span><input type="checkbox" checked={refine} onChange={(event) => setRefine(event.target.checked)} /><i /></label>
          </section>

          <section className="field-section">
            <span className="step">03</span><label>Destinations</label>
            {platforms.length > 1 && <div className="chips"><button className={platform === "all" ? "active" : ""} onClick={() => setPlatform("all")}>All</button>{platforms.map((item) => <button key={item} className={platform === item ? "active" : ""} onClick={() => setPlatform(item)}>{item}</button>)}</div>}
            <div className="channels">
              {shownChannels.map((channel) => <button type="button" key={channel.id} className={selected.includes(channel.id) ? "selected" : ""} onClick={() => toggleChannel(channel.id)}><span className="channel-icon">{channel.service[0]?.toUpperCase()}</span><span><b>{channel.displayName || channel.name}</b><small>{channel.service}</small></span><i>{selected.includes(channel.id) ? "✓" : ""}</i></button>)}
              {!configured && <p className="empty">Buffer connection required to load your channels.</p>}
            </div>
          </section>

          <section className="field-section">
            <span className="step">04</span><label>Timing</label>
            <div className="timing">{([['shareNow','Post now'],['addToQueue','Add to queue'],['customScheduled','Schedule']] as [Mode,string][]).map(([value,label]) => <button type="button" key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{label}</button>)}</div>
            {mode === "customScheduled" && <input className="date-input" type="datetime-local" value={dueAt} min={new Date().toISOString().slice(0,16)} onChange={(event) => setDueAt(event.target.value)} />}
          </section>
        </div>

        {status && <p className={`message ${status.kind}`} role="status">{status.kind === "ok" ? "✓ " : "! "}{status.text}</p>}
        <button className="primary publish-button" type="button" disabled={!ready || busy} onClick={publish}>{busy ? <><span className="spinner" /> Sending…</> : "Send to Buffer"}<span aria-hidden="true">→</span></button>
        {!key && <p className="access-warning">Open your private Atlasium link to enable publishing.</p>}
      </section>
      <footer>Your credentials stay encrypted on the server.</footer>
    </main>
  );
}
