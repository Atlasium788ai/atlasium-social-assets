"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { ProductNavigation } from "./components/product-navigation";

type Channel = { id: string; name?: string; displayName?: string; service: string; assignedBrandId?: string | null; assignedBrandName?: string | null };
type Draft = { prompt: string; timing: string; selectedChannels: string[]; updatedAt?: string };
type Brand = {
  id: string; name: string; logoUrl?: string; website?: string; industry?: string; location?: string; timezone: string; status: string;
  whatItDoes?: string; targetAudience?: string; mainOffers?: string; primaryCta?: string; tone?: string; wordsUse?: string; wordsAvoid?: string;
  visualStyle?: string; instructions?: string; routingRules?: string; channelIds: string[]; channels: Channel[]; draft?: Draft;
};
type Result = { id: string; brandId?: string; concept: string; caption: string; imageUrl: string; hostedMediaUrl?: string; mediaType?: "image" | "video"; motionStyle?: string | null; motionError?: string | null; channel: string; service: string; status: string; bufferStatus?: string | null; requestedDueAt?: string | null; dueAt?: string | null; timeZone?: string; error?: string; externalLink?: string | null };
type CampaignSummary = { id: string; brandId: string; prompt: string; status: string; timeZone: string; scheduleSummary?: string; createdAt: string; updatedAt: string };
type WorkspaceData = { workspace: { id: string; name: string; role: string }; brands: Brand[]; connectedChannels: Channel[]; recentCampaigns?: CampaignSummary[]; publishingProviders: Array<{ id: string; name: string; status: string }>; migration: { legacyCampaignsPreserved: boolean } };
type BrandForm = Omit<Brand, "id" | "status" | "channels" | "channelIds" | "draft"> & { channelIds: string[] };

const emptyBrand: BrandForm = { name: "", logoUrl: "", website: "", industry: "", location: "", timezone: "America/Toronto", whatItDoes: "", targetAudience: "", mainOffers: "", primaryCta: "", tone: "", wordsUse: "", wordsAvoid: "", visualStyle: "", instructions: "", routingRules: "{}", channelIds: [] };

function formatTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timeZone || "America/Toronto", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

function confirmedTime(result: Result) { return result.dueAt ? formatTime(result.dueAt, result.timeZone) : ""; }

function brandInitial(name: string) { return name.trim().charAt(0).toUpperCase() || "E"; }

function EchoFlowIdentity({ full = false }: { full?: boolean }) {
  return <div className={`echo-identity ${full ? "echo-identity-full" : ""}`}>
    <img
      className={full ? "echo-art-full" : "echo-art-compact"}
      src="/echoflow-social.png"
      alt="EchoFlow Social, powered by Atlasium 7/88 AI"
      width={1254}
      height={1254}
    />
    {!full && <span><b>EchoFlow</b><em>Social</em></span>}
  </div>;
}

export default function Home() {
  const [key, setKey] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [activeBrandId, setActiveBrandId] = useState("");
  const [brandSearch, setBrandSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [timing, setTiming] = useState("auto");
  const [scheduleAt, setScheduleAt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusByBrand, setStatusByBrand] = useState<Record<string, { kind: "ok" | "error"; text: string }>>({});
  const [resultsByBrand, setResultsByBrand] = useState<Record<string, Result[]>>({});
  const [campaigns, setCampaigns] = useState<Record<string, string>>({});
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<"create" | "edit">("create");
  const [wizardStep, setWizardStep] = useState(1);
  const [brandForm, setBrandForm] = useState<BrandForm>(emptyBrand);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [wizardError, setWizardError] = useState("");
  const [wizardBusy, setWizardBusy] = useState(false);
  const draftTimer = useRef<number | null>(null);

  const activeBrand = workspace?.brands.find((brand) => brand.id === activeBrandId) || null;
  const channels = activeBrand?.channels || [];
  const results = resultsByBrand[activeBrandId] || [];
  const status = statusByBrand[activeBrandId] || null;
  const campaignId = campaigns[activeBrandId] || "";
  const visibleBrands = useMemo(() => (workspace?.brands || []).filter((brand) => !brandSearch || brand.name.toLowerCase().includes(brandSearch.toLowerCase())), [workspace, brandSearch]);
  const campaignHistory = (workspace?.recentCampaigns || []).filter((campaign) => campaign.brandId === activeBrandId);

  function authHeaders(brandId?: string) { return { "X-Upload-Key": key, ...(brandId ? { "X-Brand-ID": brandId } : {}) }; }
  function setBrandStatus(brandId: string, next: { kind: "ok" | "error"; text: string } | null) { setStatusByBrand((current) => { const copy = { ...current }; if (next) copy[brandId] = next; else delete copy[brandId]; return copy; }); }

  async function loadWorkspace(authKey = key, preferredBrandId?: string) {
    const response = await fetch("/api/workspace", { headers: { "X-Upload-Key": authKey } });
    const data = await response.json() as WorkspaceData & { error?: string };
    if (!response.ok) throw new Error(data.error || "Could not load EchoFlow Social.");
    setWorkspace(data);
    const remembered = preferredBrandId || localStorage.getItem("echoflow-active-brand") || "";
    const next = data.brands.find((brand) => brand.id === remembered) || data.brands[0];
    if (next) activateBrand(next, false);
    const restored: Record<string, string> = {};
    for (const brand of data.brands) { const id = localStorage.getItem(`echoflow-active-campaign:${brand.id}`); if (id) restored[brand.id] = id; }
    setCampaigns(restored);
  }

  useEffect(() => {
    const hashKey = new URLSearchParams(location.hash.slice(1)).get("key");
    if (hashKey) {
      localStorage.setItem("atlasium-upload-key", hashKey);
      localStorage.setItem("echoflow-access-key", hashKey);
      window.history.replaceState(null, "", location.pathname);
    }
    const authKey = hashKey || localStorage.getItem("echoflow-access-key") || localStorage.getItem("atlasium-upload-key") || "";
    // Browser-held private access is intentionally restored after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(authKey);
    if (authKey) loadWorkspace(authKey).catch((error: Error) => setBrandStatus("system", { kind: "error", text: error.message }));
    // Private access is restored once on hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!workspace || new URLSearchParams(location.search).get("new-brand") !== "1") return;
    openBrandWizard("create");
    window.history.replaceState(null, "", location.pathname);
    // This bridges AMPLIFY to the existing New Brand workflow without changing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  useEffect(() => {
    const entries = Object.entries(campaigns);
    if (!key || !entries.length) return;
    let stopped = false;
    const refresh = async () => {
      await Promise.all(entries.map(async ([brandId, id]) => {
        try {
          const response = await fetch(`/api/campaign/${encodeURIComponent(id)}`, { headers: authHeaders(brandId) });
          const data = await response.json() as { message?: string; error?: string; results?: Result[]; processing?: boolean };
          if (!response.ok) throw new Error(data.error || "Could not refresh campaign progress.");
          if (stopped) return;
          setResultsByBrand((current) => ({ ...current, [brandId]: data.results || [] }));
          setBrandStatus(brandId, { kind: data.results?.some((result) => result.status === "FAILED") ? "error" : "ok", text: data.message || "Campaign progress updated." });
          if (!data.processing) {
            localStorage.removeItem(`echoflow-active-campaign:${brandId}`);
            setCampaigns((current) => { const copy = { ...current }; delete copy[brandId]; return copy; });
            void loadWorkspace(key, activeBrandId);
          }
        } catch (error) { if (!stopped) setBrandStatus(brandId, { kind: "error", text: error instanceof Error ? error.message : "Could not refresh campaign progress." }); }
      }));
    };
    void refresh();
    const timer = window.setInterval(refresh, 6000);
    return () => { stopped = true; window.clearInterval(timer); };
    // Polling is intentionally keyed only by immutable campaign/brand pairs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, key]);

  useEffect(() => {
    if (!key || !activeBrandId) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => { void persistDraft(activeBrandId, { prompt, timing, selectedChannels: selected }, false); }, 900);
    return () => { if (draftTimer.current) window.clearTimeout(draftTimer.current); };
    // Draft values are the intended dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, timing, selected, activeBrandId, key]);

  async function persistDraft(brandId: string, draft: Draft, announce = true) {
    if (!key || !brandId) return;
    const response = await fetch(`/api/brands/${encodeURIComponent(brandId)}/draft`, { method: "PUT", headers: { ...authHeaders(brandId), "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (!response.ok) return;
    setWorkspace((current) => current ? { ...current, brands: current.brands.map((brand) => brand.id === brandId ? { ...brand, draft } : brand) } : current);
    if (announce) setBrandStatus(brandId, { kind: "ok", text: "Draft saved to this brand." });
  }

  function activateBrand(brand: Brand, saveCurrent = true) {
    if (saveCurrent && activeBrandId && activeBrandId !== brand.id) void persistDraft(activeBrandId, { prompt, timing, selectedChannels: selected });
    setActiveBrandId(brand.id);
    localStorage.setItem("echoflow-active-brand", brand.id);
    setPrompt(brand.draft?.prompt || "");
    setTiming(brand.draft?.timing || "auto");
    setSelected((brand.draft?.selectedChannels || []).filter((id) => brand.channelIds.includes(id)));
    setScheduleAt("");
  }

  async function createAndPublish() {
    if (busy || !activeBrand) return;
    if (!key) { setBrandStatus(activeBrand.id, { kind: "error", text: "Open your private EchoFlow link to enable publishing." }); return; }
    if (!prompt.trim()) { setBrandStatus(activeBrand.id, { kind: "error", text: "Enter a campaign prompt first." }); return; }
    if (!channels.length) { setBrandStatus(activeBrand.id, { kind: "error", text: "Assign at least one social destination in Brand settings." }); return; }
    setBusy(true); setBrandStatus(activeBrand.id, null); setResultsByBrand((current) => ({ ...current, [activeBrand.id]: [] }));
    try {
      if (timing === "schedule" && !scheduleAt) throw new Error("Choose the exact date and time to schedule.");
      const response = await fetch("/api/agent", { method: "POST", headers: { ...authHeaders(activeBrand.id), "Content-Type": "application/json" }, body: JSON.stringify({ brandId: activeBrand.id, prompt: prompt.trim(), channels: selected, timing, selectedLocalTime: timing === "schedule" ? scheduleAt : undefined, timeZone: activeBrand.timezone }) });
      const data = await response.json() as { campaignId?: string; message?: string; error?: string; results?: Result[] };
      if (!response.ok) throw new Error(data.error || "Campaign creation failed.");
      const returned = data.results || [];
      setResultsByBrand((current) => ({ ...current, [activeBrand.id]: returned }));
      if (data.campaignId && returned.some((result) => result.status === "PROCESSING MOTION")) {
        localStorage.setItem(`echoflow-active-campaign:${activeBrand.id}`, data.campaignId);
        setCampaigns((current) => ({ ...current, [activeBrand.id]: data.campaignId! }));
      }
      setBrandStatus(activeBrand.id, { kind: returned.some((result) => result.status === "FAILED") ? "error" : "ok", text: data.message || "Campaign sent to Buffer." });
      await persistDraft(activeBrand.id, { prompt: "", timing: "auto", selectedChannels: [] }, false);
      setPrompt(""); setTiming("auto"); setSelected([]);
    } catch (error) { setBrandStatus(activeBrand.id, { kind: "error", text: error instanceof Error ? error.message : "Campaign creation failed." }); }
    finally { setBusy(false); }
  }

  function toggleChannel(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function setBrandField(field: keyof BrandForm, value: string | string[]) { setBrandForm((current) => ({ ...current, [field]: value })); }

  function openBrandWizard(mode: "create" | "edit") {
    setWizardMode(mode); setWizardStep(1); setWizardError(""); setLogoFile(null);
    setBrandForm(mode === "edit" && activeBrand ? { name: activeBrand.name, logoUrl: activeBrand.logoUrl || "", website: activeBrand.website || "", industry: activeBrand.industry || "", location: activeBrand.location || "", timezone: activeBrand.timezone, whatItDoes: activeBrand.whatItDoes || "", targetAudience: activeBrand.targetAudience || "", mainOffers: activeBrand.mainOffers || "", primaryCta: activeBrand.primaryCta || "", tone: activeBrand.tone || "", wordsUse: activeBrand.wordsUse || "", wordsAvoid: activeBrand.wordsAvoid || "", visualStyle: activeBrand.visualStyle || "", instructions: activeBrand.instructions || "", routingRules: activeBrand.routingRules || "{}", channelIds: activeBrand.channelIds } : emptyBrand);
    setWizardOpen(true);
  }

  function nextWizardStep() {
    setWizardError("");
    if (wizardStep === 1 && !brandForm.name.trim()) { setWizardError("Add the brand name first."); return; }
    if (wizardStep === 3 && !brandForm.channelIds.length) { setWizardError("Choose at least one available social destination."); return; }
    setWizardStep((step) => Math.min(4, step + 1));
  }

  async function submitBrand() {
    if (!key || (wizardMode === "edit" && !activeBrand)) return;
    setWizardBusy(true); setWizardError("");
    try {
      const form = new FormData(); form.set("profile", JSON.stringify(brandForm)); if (logoFile) form.set("logo", logoFile);
      const url = wizardMode === "create" ? "/api/brands" : `/api/brands/${encodeURIComponent(activeBrand!.id)}`;
      const response = await fetch(url, { method: wizardMode === "create" ? "POST" : "PATCH", headers: authHeaders(activeBrand?.id), body: form });
      const data = await response.json() as { brand?: Brand; error?: string };
      if (!response.ok || !data.brand) throw new Error(data.error || "Could not save the brand.");
      setWizardOpen(false);
      await loadWorkspace(key, data.brand.id);
      setBrandStatus(data.brand.id, { kind: "ok", text: wizardMode === "create" ? "Brand created. Create its first campaign when ready." : "Brand settings saved." });
    } catch (error) { setWizardError(error instanceof Error ? error.message : "Could not save the brand."); }
    finally { setWizardBusy(false); }
  }

  if (!key) return <main className="welcome-shell">
    <section className="welcome-card">
      <EchoFlowIdentity full />
      <ProductNavigation active="echo" />
      <p>One prompt. Every brand. One controlled publishing flow.</p>
      <div className="access-warning">Open your private authenticated EchoFlow link in this browser to continue.</div>
      <a href="https://www.echoflowsocial.ca" target="_blank" rel="noreferrer">echoflowsocial.ca</a>
    </section>
  </main>;

  return <main className="app-shell">
    <header className="app-header"><EchoFlowIdentity /><span className="powered">Powered by Atlasium 7/88 AI</span></header>
    <ProductNavigation active="echo" />

    <nav className="brand-nav" aria-label="Brands">
      <div className="brand-tabs">
        {visibleBrands.map((brand) => <button type="button" key={brand.id} className={brand.id === activeBrandId ? "brand-tab active" : "brand-tab"} onClick={() => activateBrand(brand)}><span>{brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : brandInitial(brand.name)}</span>{brand.name}</button>)}
        <button type="button" className="brand-tab new" onClick={() => openBrandWizard("create")}>+ New Brand</button>
      </div>
      {(workspace?.brands.length || 0) > 5 && <input className="brand-search" value={brandSearch} onChange={(event) => setBrandSearch(event.target.value)} placeholder="Find a brand" aria-label="Find a brand" />}
    </nav>

    {activeBrand && <>
      <section className="active-brand-strip">
        <div className="active-logo">{activeBrand.logoUrl ? <img src={activeBrand.logoUrl} alt={`${activeBrand.name} logo`} /> : brandInitial(activeBrand.name)}</div>
        <div><span>ACTIVE BRAND</span><h2>{activeBrand.name}</h2><small>{activeBrand.timezone} · {activeBrand.channels.length} destination{activeBrand.channels.length === 1 ? "" : "s"}</small></div>
        <button type="button" className="text-button" onClick={() => openBrandWizard("edit")}>Brand settings</button>
      </section>

      <section className="card agent-card">
        <p className="eyebrow">ONE PROMPT → DELIVERED</p>
        <h1>What should<br />we create?</h1>
        <p className="lede">EchoFlow uses {activeBrand.name}&apos;s voice, visuals, channels and timezone. Running jobs stay locked to this brand even if you switch tabs.</p>
        <textarea className="prompt-box" rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={`Create 4 ${activeBrand.name} social posts and schedule them this week.`} aria-label="Campaign prompt" />

        <details className="options">
          <summary>Options <span>{selected.length ? `${selected.length} chosen` : "auto channels"} · {timing === "auto" ? "automatic timing" : timing}</span></summary>
          <div className="option-block"><span className="option-label">{activeBrand.name} destinations</span><div className="channels compact">
            {channels.map((channel) => <button type="button" key={channel.id} className={selected.includes(channel.id) ? "selected" : ""} onClick={() => toggleChannel(channel.id)}><span className="channel-icon">{channel.service[0]?.toUpperCase()}</span><span><b>{channel.displayName || channel.name}</b><small>{channel.service}</small></span><i>{selected.includes(channel.id) ? "✓" : ""}</i></button>)}
            {!channels.length ? <p className="empty">Add at least one destination in Brand settings.</p> : <p className="empty">Leave all unselected for automatic routing. Selecting channels overrides it.</p>}
          </div></div>
          <div className="option-block"><span className="option-label">Timing</span><div className="timing">{[["auto","From prompt / Auto"],["now","Post now"],["queue","Buffer queue"],["schedule","Exact date/time"]].map(([value,label]) => <button type="button" key={value} className={timing === value ? "active" : ""} onClick={() => setTiming(value)}>{label}</button>)}</div></div>
          {timing === "schedule" && <div className="option-block"><label className="option-label" htmlFor="schedule-at">Exact date and time · {activeBrand.timezone}</label><input id="schedule-at" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></div>}
        </details>

        {status && <p className={`message ${status.kind}`} role="status">{status.kind === "ok" ? "✓ " : "! "}{status.text}</p>}
        <button className="primary agent-button" disabled={busy || Boolean(campaignId)} onClick={createAndPublish}>{busy ? <><span className="spinner" /> Creating campaign…</> : campaignId ? <><span className="spinner" /> Processing campaign…</> : <>Create &amp; Publish <span>→</span></>}</button>
      </section>

      {results.length > 0 && <section className="results"><div className="results-head"><p className="eyebrow">{activeBrand.name.toUpperCase()} · DELIVERY</p><h2>Confirmed campaign status</h2></div>{results.map((result) => <article className={`result ${result.status === "FAILED" ? "failed" : ""}`} key={result.id}>{result.mediaType === "video" && result.hostedMediaUrl ? <video src={result.hostedMediaUrl} poster={result.imageUrl} controls playsInline muted /> : <img src={result.imageUrl} alt="Generated social media creative" />}<div><span className="result-status">{result.status} · {result.mediaType === "video" ? "MOTION VIDEO" : "STATIC IMAGE"}</span><h3>{result.concept}</h3><p>{result.caption}</p><small>{result.service} · {result.channel}{confirmedTime(result) ? ` · ${confirmedTime(result)}` : ""}{result.bufferStatus ? ` · Buffer: ${result.bufferStatus}` : ""}</small>{result.externalLink && <a className="post-link" href={result.externalLink} target="_blank" rel="noreferrer">View published post</a>}{result.motionError && <p className="result-error">Motion fallback: {result.motionError}</p>}{result.error && <p className="result-error">{result.error}{result.requestedDueAt ? ` Requested: ${formatTime(result.requestedDueAt, result.timeZone)}.` : ""}</p>}</div></article>)}</section>}

      <details className="history-panel"><summary>Recent {activeBrand.name} campaigns <span>{campaignHistory.length}</span></summary>{campaignHistory.length ? <div className="history-list">{campaignHistory.slice(0, 8).map((campaign) => <div key={campaign.id}><b>{campaign.prompt || "Preserved Atlasium campaign"}</b><small>{campaign.status} · {campaign.scheduleSummary || campaign.timeZone} · {formatTime(campaign.updatedAt, campaign.timeZone)}</small></div>)}</div> : <p className="empty">No campaigns yet. Your first campaign will appear here.</p>}</details>
      <details className="provider-panel"><summary>Publishing connections</summary><div>{workspace?.publishingProviders.map((provider) => <p key={provider.id}><span className={provider.status === "ACTIVE" ? "dot active" : "dot"} />{provider.name}<b>{provider.status}</b></p>)}</div></details>
    </>}

    <footer>EchoFlow Social · <a href="https://www.echoflowsocial.ca" target="_blank" rel="noreferrer">echoflowsocial.ca</a> · Credentials stay encrypted on the server.</footer>

    {wizardOpen && <div className="modal-backdrop" role="presentation"><section className="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <header><div><p className="eyebrow">STEP {wizardStep} OF 4</p><h2 id="wizard-title">{wizardMode === "create" ? "New brand" : `Edit ${activeBrand?.name}`}</h2></div><button type="button" className="close" onClick={() => setWizardOpen(false)} aria-label="Close">×</button></header>
      <div className="steps" aria-hidden="true">{[1,2,3,4].map((step) => <i key={step} className={step <= wizardStep ? "done" : ""} />)}</div>

      {wizardStep === 1 && <div className="wizard-body"><h3>Identity</h3><label>Brand name<input value={brandForm.name} onChange={(event) => setBrandField("name", event.target.value)} /></label><label>Logo<input type="file" accept="image/*" onChange={(event) => setLogoFile(event.target.files?.[0] || null)} /><small>{logoFile?.name || (brandForm.logoUrl ? "Current logo will be kept" : "PNG, JPG, WebP, GIF or HEIC")}</small></label><div className="field-grid"><label>Website<input value={brandForm.website} onChange={(event) => setBrandField("website", event.target.value)} /></label><label>Industry<input value={brandForm.industry} onChange={(event) => setBrandField("industry", event.target.value)} /></label><label>Location / service area<input value={brandForm.location} onChange={(event) => setBrandField("location", event.target.value)} /></label><label>Timezone<input value={brandForm.timezone} onChange={(event) => setBrandField("timezone", event.target.value)} placeholder="America/Toronto" /></label></div></div>}

      {wizardStep === 2 && <div className="wizard-body"><h3>Brand brain</h3><label>What does the company do?<textarea value={brandForm.whatItDoes} onChange={(event) => setBrandField("whatItDoes", event.target.value)} /></label><div className="field-grid"><label>Target audience<textarea value={brandForm.targetAudience} onChange={(event) => setBrandField("targetAudience", event.target.value)} /></label><label>Main offers<textarea value={brandForm.mainOffers} onChange={(event) => setBrandField("mainOffers", event.target.value)} /></label><label>Primary call to action<input value={brandForm.primaryCta} onChange={(event) => setBrandField("primaryCta", event.target.value)} /></label><label>Tone of voice<input value={brandForm.tone} onChange={(event) => setBrandField("tone", event.target.value)} /></label><label>Words to use<input value={brandForm.wordsUse} onChange={(event) => setBrandField("wordsUse", event.target.value)} /></label><label>Words to avoid<input value={brandForm.wordsAvoid} onChange={(event) => setBrandField("wordsAvoid", event.target.value)} /></label><label>Visual style<textarea value={brandForm.visualStyle} onChange={(event) => setBrandField("visualStyle", event.target.value)} /></label><label>Additional instructions<textarea value={brandForm.instructions} onChange={(event) => setBrandField("instructions", event.target.value)} /></label></div></div>}

      {wizardStep === 3 && <div className="wizard-body"><h3>Social channels</h3><p className="wizard-help">Assign only destinations that belong to this brand. A destination cannot be shared across brands.</p><div className="assignment-list">{workspace?.connectedChannels.map((channel) => { const ownedHere = channel.assignedBrandId === activeBrand?.id && wizardMode === "edit"; const unavailable = Boolean(channel.assignedBrandId && !ownedHere); const checked = brandForm.channelIds.includes(channel.id); return <label key={channel.id} className={unavailable ? "unavailable" : ""}><input type="checkbox" disabled={unavailable} checked={checked} onChange={() => setBrandField("channelIds", checked ? brandForm.channelIds.filter((id) => id !== channel.id) : [...brandForm.channelIds, channel.id])} /><span className="channel-icon">{channel.service[0]?.toUpperCase()}</span><span><b>{channel.displayName || channel.name}</b><small>{channel.service}{unavailable ? ` · assigned to ${channel.assignedBrandName}` : ""}</small></span></label>})}</div></div>}

      {wizardStep === 4 && <div className="wizard-body review"><h3>Review</h3><div><span>Brand</span><b>{brandForm.name}</b></div><div><span>Timezone</span><b>{brandForm.timezone}</b></div><div><span>Connected channels</span><b>{brandForm.channelIds.length}</b></div><div><span>Content direction</span><b>{brandForm.tone || brandForm.whatItDoes || "Clear and professional"}</b></div><div><span>Default routing</span><b>Prompt-led automatic routing</b></div></div>}

      {wizardError && <p className="message error" role="alert">! {wizardError}</p>}
      <footer className="wizard-actions">{wizardStep > 1 && <button type="button" className="secondary" onClick={() => setWizardStep((step) => step - 1)}>Back</button>}<button type="button" className="primary" disabled={wizardBusy} onClick={wizardStep === 4 ? submitBrand : nextWizardStep}>{wizardBusy ? "Saving…" : wizardStep === 4 ? (wizardMode === "create" ? "Create Brand" : "Save Brand") : "Continue"}</button></footer>
    </section></div>}
  </main>;
}
