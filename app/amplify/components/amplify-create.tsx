"use client";

/* eslint-disable @next/next/no-img-element, jsx-a11y/media-has-caption */

import { useEffect, useMemo, useRef, useState } from "react";
import { AMPLIFY_PROVIDER_CAPABILITIES, amplifyProvider } from "../providers/amplify-provider-catalog";
import { prepareAmplifyDraft, runAmplifyDryTest, updateAmplifyDraft, uploadAmplifyCreative } from "../services/amplify-ad-service";
import type { AmplifyAudience, AmplifyBrand, AmplifyBudget, AmplifyCreativeSource, AmplifyDraft, AmplifyDraftPayload, AmplifyDryTestResult, AmplifyGoal, AmplifyProviderId, AmplifySchedule } from "../types";

const goals: readonly { id: AmplifyGoal; label: string }[] = [
  { id: "leads", label: "Get Leads" }, { id: "bookings", label: "Get Bookings" }, { id: "calls_messages", label: "Get Calls or Messages" }, { id: "website_sales", label: "Get Website Sales" }, { id: "website_traffic", label: "Get Website Traffic" }, { id: "awareness", label: "Build Awareness" }, { id: "promote_post", label: "Promote a Post" },
];

const providerReasons: Record<AmplifyProviderId, string> = {
  meta: "Strong visual reach, lead forms and retargeting architecture.",
  google_ads: "Captures active intent across search, display and YouTube.",
  linkedin: "Useful for professional and business audiences.",
  tiktok: "Best when the creative works as native vertical video.",
  x: "Useful for timely conversation and awareness.",
  pinterest: "Useful for visual discovery and shopping intent.",
  snapchat: "Useful for visual reach with younger audiences.",
  bluesky: "Advertising is not available.",
};

function recommendedProviders(goal: AmplifyGoal): AmplifyProviderId[] {
  if (goal === "leads" || goal === "bookings") return ["meta", "google_ads", "linkedin"];
  if (goal === "calls_messages") return ["meta", "google_ads"];
  if (goal === "website_sales") return ["meta", "google_ads", "tiktok", "pinterest"];
  if (goal === "website_traffic") return ["meta", "google_ads", "linkedin"];
  if (goal === "promote_post") return ["meta", "linkedin", "tiktok", "x", "pinterest"];
  return ["meta", "tiktok", "linkedin", "x"];
}

function localDate(daysFromNow: number, time: string) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${time}`;
}

function calculateMaximum(budget: Pick<AmplifyBudget, "type" | "amount">, schedule: AmplifySchedule) {
  if (budget.type === "lifetime") return Math.max(0, Number(budget.amount || 0));
  const start = new Date(`${schedule.startAt.slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${schedule.endAt.slice(0, 10)}T00:00:00Z`).getTime();
  const days = Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.floor((end - start) / 86_400_000) + 1) : 1;
  return Math.round(Number(budget.amount || 0) * days * 100) / 100;
}

function previewDraft(brand: AmplifyBrand, input: Omit<AmplifyDraftPayload, "campaignName" | "variations" | "explicitConfirmation">): AmplifyDraft {
  const now = new Date().toISOString();
  return {
    id: `mock_ad_draft_${brand.id}`,
    brandId: brand.id,
    name: `${input.offer} · MOCK PREVIEW`,
    status: "ready_for_review",
    prompt: input.prompt,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    platformStatuses: input.providerIds.map((providerId) => ({ providerId, status: "ready_for_review", detail: "Mock preview only. No platform contacted." })),
    payload: { ...input, campaignName: `${input.offer} · MOCK PREVIEW`, explicitConfirmation: false, variations: input.providerIds.map((providerId) => ({ providerId, headline: input.offer, body: input.prompt, callToAction: input.callToAction, placement: amplifyProvider(providerId)?.supportedPlacements[0] || "Platform-supported placement", format: input.creativeSource.mediaType === "video" ? "Video" : "Single image", mediaSourceId: input.creativeSource.id })) },
  };
}

export function AmplifyCreate({ brand, sources, drafts, privateKey, previewMode, dryRunEnabled, onDraft, onCreative }: { brand: AmplifyBrand; sources: AmplifyCreativeSource[]; drafts: AmplifyDraft[]; privateKey: string; previewMode: boolean; dryRunEnabled: boolean; onDraft(draft: AmplifyDraft): void; onCreative(source: AmplifyCreativeSource): void }) {
  const [step, setStep] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [offer, setOffer] = useState(brand.mainOffers || "");
  const [goal, setGoal] = useState<AmplifyGoal>("leads");
  const [destinationType, setDestinationType] = useState<AmplifyDraftPayload["destinationType"]>("landing_page");
  const [destination, setDestination] = useState("");
  const [callToAction, setCallToAction] = useState(brand.primaryCta || "Learn more");
  const [sourceId, setSourceId] = useState(sources[0]?.id || "");
  const [audience, setAudience] = useState<AmplifyAudience>({ location: brand.location || "", summary: brand.targetAudience || "", ageMin: 25, ageMax: 65, interests: "", restrictedCategory: "none" });
  const [providerIds, setProviderIds] = useState<AmplifyProviderId[]>(() => recommendedProviders("leads"));
  const [manualPlatforms, setManualPlatforms] = useState(false);
  const [budget, setBudget] = useState<AmplifyBudget>({ type: "daily", amount: 25, currency: "CAD", maximumSpend: 0 });
  const [schedule, setSchedule] = useState<AmplifySchedule>({ startAt: localDate(1, "09:00"), endAt: localDate(8, "17:00"), timezone: brand.timezone });
  const [draft, setDraft] = useState<AmplifyDraft | null>(null);
  const [recommendedVariations, setRecommendedVariations] = useState<AmplifyDraftPayload["variations"]>([]);
  const [dryResult, setDryResult] = useState<AmplifyDryTestResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(`amplify-dry-${crypto.randomUUID()}`);
  const loadedDraftId = useRef("");

  const source = sources.find((item) => item.id === sourceId) || null;
  const maxSpend = useMemo(() => calculateMaximum(budget, schedule), [budget, schedule]);
  const restricted = audience.restrictedCategory !== "none";

  useEffect(() => {
    if (!sourceId && sources[0]) queueMicrotask(() => setSourceId(sources[0].id));
  }, [sourceId, sources]);

  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("draft");
    const existing = requested ? drafts.find((item) => item.id === requested) : null;
    if (!existing || loadedDraftId.current === existing.id) return;
    loadedDraftId.current = existing.id;
    const value = existing.payload;
    queueMicrotask(() => { setPrompt(value.prompt); setOffer(value.offer); setGoal(value.goal); setDestinationType(value.destinationType); setDestination(value.destination); setCallToAction(value.callToAction); setSourceId(value.creativeSource.id); setAudience(value.audience); setProviderIds(value.providerIds); setManualPlatforms(true); setBudget(value.budget); setSchedule(value.schedule); setDraft(existing); setRecommendedVariations(value.variations.map((variation) => ({ ...variation }))); setStep(4); });
  }, [drafts]);

  function validateStage(stage: number) {
    if (stage === 1) {
      if (!prompt.trim()) return "Tell us what you want to promote.";
      if (!offer.trim()) return "Name the offer or item being promoted.";
      if (!destination.trim()) return "Add the real campaign destination. EchoFlow will not invent one.";
      if (!callToAction.trim()) return "Choose a call to action.";
      if (!source) return "Choose an existing brand-owned creative or upload one.";
    }
    if (stage === 2 && (!audience.location.trim() || !audience.summary.trim())) return "Add a location and plain-language audience.";
    if (stage === 3) {
      if (!providerIds.length) return "Choose at least one advertising platform.";
      if (budget.amount <= 0) return "Enter a budget greater than zero.";
      if (!schedule.startAt || !schedule.endAt || schedule.endAt <= schedule.startAt) return "Choose an end time after the campaign starts.";
    }
    return "";
  }

  function goNext() {
    const message = validateStage(step);
    if (message) { setError(message); return; }
    setError("");
    setStep((current) => Math.min(4, current + 1));
  }

  function toggleProvider(providerId: AmplifyProviderId) {
    const provider = amplifyProvider(providerId);
    if (!provider?.advertisingAvailable) return;
    setManualPlatforms(true);
    setProviderIds((current) => current.includes(providerId) ? current.filter((item) => item !== providerId) : [...current, providerId]);
  }

  async function upload(file?: File) {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const created = previewMode ? { id: `mock_upload_${brand.id}`, brandId: brand.id, sourceType: file.type.startsWith("video/") ? "uploaded_video" as const : "uploaded_image" as const, label: file.name, mediaType: file.type.startsWith("video/") ? "video" as const : "image" as const, url: URL.createObjectURL(file), detail: "MOCK PREVIEW upload · stored only for this browser preview" } : await uploadAmplifyCreative(privateKey, brand.id, file);
      onCreative(created); setSourceId(created.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not upload this creative."); }
    finally { setUploading(false); }
  }

  function inputForDraft(): Omit<AmplifyDraftPayload, "campaignName" | "variations" | "explicitConfirmation"> | null {
    if (!source) return null;
    return { prompt: prompt.trim(), offer: offer.trim(), goal, destinationType, destination: destination.trim(), callToAction: callToAction.trim(), creativeSource: source, audience: restricted ? { ...audience, ageMin: 18, ageMax: 65, interests: "" } : audience, providerIds, budget: { ...budget, maximumSpend: maxSpend }, schedule };
  }

  async function prepareReview() {
    const message = validateStage(3);
    const input = inputForDraft();
    if (message || !input) { setError(message || "Choose a creative source."); return; }
    setBusy(true); setError("");
    try {
      const prepared = previewMode ? previewDraft(brand, input) : await prepareAmplifyDraft(privateKey, brand.id, input);
      setDraft(prepared); setRecommendedVariations(prepared.payload.variations.map((variation) => ({ ...variation }))); setStep(4); onDraft(prepared);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare the review."); }
    finally { setBusy(false); }
  }

  function editVariation(providerId: AmplifyProviderId, field: "headline" | "body" | "callToAction", value: string) {
    if (!draft) return;
    setDraft({ ...draft, payload: { ...draft.payload, variations: draft.payload.variations.map((variation) => variation.providerId === providerId ? { ...variation, [field]: value, manuallyEdited: true } : variation) } });
  }

  function removePlatform(providerId: AmplifyProviderId) {
    if (!draft || draft.payload.providerIds.length === 1) { setError("Keep at least one platform in this campaign."); return; }
    const next = { ...draft, payload: { ...draft.payload, providerIds: draft.payload.providerIds.filter((item) => item !== providerId), variations: draft.payload.variations.filter((item) => item.providerId !== providerId) } };
    setDraft(next); setProviderIds(next.payload.providerIds); setManualPlatforms(true);
  }

  function restoreVariation(providerId: AmplifyProviderId) {
    if (!draft) return;
    const recommended = recommendedVariations.find((variation) => variation.providerId === providerId);
    if (!recommended) return;
    setDraft({ ...draft, payload: { ...draft.payload, variations: draft.payload.variations.map((variation) => variation.providerId === providerId ? { ...recommended, manuallyEdited: false } : variation) } });
  }

  function regenerateVariation(providerId: AmplifyProviderId) {
    if (!draft) return;
    const current = draft.payload.variations.find((variation) => variation.providerId === providerId);
    if (current?.manuallyEdited && !window.confirm("Replace your manual edits for this platform with the recommended version?")) return;
    restoreVariation(providerId);
  }

  async function dryTest() {
    if (!draft) return;
    if (!confirmed) { setError("Confirm that you reviewed the campaign before running the dry test."); return; }
    setBusy(true); setError("");
    try {
      let saved = draft;
      if (!previewMode) saved = await updateAmplifyDraft(privateKey, brand.id, draft.id, { ...draft.payload, explicitConfirmation: true });
      const result = previewMode ? { id: `mock_dry_${brand.id}`, draftId: saved.id, brandId: brand.id, status: "dry_test_passed" as const, validationStatus: "Requires Compliance Review" as const, duplicate: false, createdAt: new Date().toISOString(), checks: [{ label: "Required fields", status: "passed" as const, detail: "Mock draft fields are complete." }, { label: "Advertising permission", status: "review" as const, detail: "Official platform approval is still required." }, { label: "Live submission", status: "passed" as const, detail: "Disabled. No platform was contacted." }] } : await runAmplifyDryTest(privateKey, brand.id, saved.id, idempotencyKey.current, true);
      const complete = { ...saved, status: result.status === "dry_test_passed" ? "dry_test_passed" as const : "failed" as const, payload: { ...saved.payload, explicitConfirmation: true } };
      setDraft(complete); onDraft(complete); setDryResult(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The dry test failed."); }
    finally { setBusy(false); }
  }

  return <section className="amplify-create">
    <header className="amplify-page-heading"><div><p className="eyebrow">CREATE · {brand.name}</p><h1>Create an Ad</h1><p>Four short stages. Every required decision stays visible.</p></div>{previewMode && <span className="amplify-preview-label">MOCK PREVIEW — NO LIVE ADS</span>}</header>
    <ol className="amplify-steps" aria-label="Advertising campaign stages">{["What", "Audience", "Budget", "Review"].map((label, index) => <li key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""}><span>{step > index + 1 ? "✓" : index + 1}</span><b>{label}</b></li>)}</ol>

    {step === 1 && <div className="amplify-stage">
      <div className="amplify-stage-intro"><span>01</span><div><h2>What are we promoting?</h2><p>Start naturally. EchoFlow will preserve your facts and intent.</p></div></div>
      <label className="amplify-prompt-label">Campaign prompt<textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Tell us what you want to promote, who it is for and what result you want." /></label>
      <div className="amplify-field-grid"><label>Offer<input value={offer} onChange={(event) => setOffer(event.target.value)} placeholder="The real offer or product" /></label><label>Goal<select value={goal} onChange={(event) => { const next = event.target.value as AmplifyGoal; setGoal(next); if (!manualPlatforms) setProviderIds(recommendedProviders(next)); }}>{goals.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
      <div className="amplify-field-grid"><label>Destination type<select value={destinationType} onChange={(event) => setDestinationType(event.target.value as AmplifyDraftPayload["destinationType"])}><option value="landing_page">Landing page</option><option value="website">Website</option><option value="lead_form">Lead form</option><option value="booking_page">Booking page</option><option value="phone">Phone number</option><option value="messages">Messaging destination</option><option value="app">App destination</option><option value="existing_post">Existing platform post</option></select></label><label>Real destination<input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Paste the real URL, phone number or destination" /><small>Never taken from artwork. Never invented.</small></label></div>
      <label>Call to action<input value={callToAction} onChange={(event) => setCallToAction(event.target.value)} placeholder="Book now, Learn more, Send a message…" /></label>
      <fieldset className="amplify-source-picker"><legend>Creative source</legend>{sources.length ? <div>{sources.map((item) => <label key={item.id} className={sourceId === item.id ? "selected" : ""}><input type="radio" name="creative-source" value={item.id} checked={sourceId === item.id} onChange={() => setSourceId(item.id)} />{item.url && item.mediaType !== "post" ? item.mediaType === "video" ? <video src={item.url} muted playsInline /> : <img src={item.url} alt="" /> : <span className="amplify-source-mark">{item.sourceType === "flow_post" ? "FLOW" : "ECHO"}</span>}<span><b>{item.label}</b><small>{item.detail}</small></span></label>)}</div> : <p className="amplify-inline-empty">No ECHO or FLOW creative is available for this brand yet. Upload one below.</p>}<label className="amplify-upload"><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={(event) => void upload(event.target.files?.[0])} /><span>{uploading ? "Uploading…" : "+ Upload image or video"}</span></label></fieldset>
    </div>}

    {step === 2 && <div className="amplify-stage">
      <div className="amplify-stage-intro"><span>02</span><div><h2>Who and where?</h2><p>Keep the audience clear. Platform-specific translation happens later.</p></div></div>
      <label>Audience summary<textarea rows={3} value={audience.summary} onChange={(event) => setAudience({ ...audience, summary: event.target.value })} placeholder="Business owners who need a more reliable follow-up system" /></label>
      <div className="amplify-field-grid"><label>Location<input value={audience.location} onChange={(event) => setAudience({ ...audience, location: event.target.value })} placeholder="Toronto, Ontario" /></label><label>Restricted category<select value={audience.restrictedCategory} onChange={(event) => setAudience({ ...audience, restrictedCategory: event.target.value as AmplifyAudience["restrictedCategory"] })}><option value="none">None</option><option value="housing">Housing</option><option value="employment">Employment</option><option value="credit">Credit</option><option value="financial_services">Financial services</option><option value="politics">Politics</option></select></label></div>
      {restricted && <p className="amplify-policy-note"><strong>Restricted targeting protection</strong><span>Detailed age and interest targeting is removed. Full compliance review is still required.</span></p>}
      <details className="amplify-advanced"><summary>Advanced audience options</summary><div className="amplify-field-grid"><label>Age range<div className="amplify-age"><input type="number" min="18" max="65" disabled={restricted} value={restricted ? 18 : audience.ageMin} onChange={(event) => setAudience({ ...audience, ageMin: Number(event.target.value) })} /><span>to</span><input type="number" min="18" max="65" disabled={restricted} value={restricted ? 65 : audience.ageMax} onChange={(event) => setAudience({ ...audience, ageMax: Number(event.target.value) })} /></div></label><label>Interests or professional criteria<input disabled={restricted} value={restricted ? "" : audience.interests} onChange={(event) => setAudience({ ...audience, interests: event.target.value })} placeholder="Optional" /></label></div></details>
      <div className="amplify-audience-summary"><span>RECOMMENDED AUDIENCE</span><p>{audience.summary || "Add an audience"} · {audience.location || "Add a location"}{restricted ? " · Restricted-category safeguards applied" : ` · Ages ${audience.ageMin}–${audience.ageMax}`}</p></div>
    </div>}

    {step === 3 && <div className="amplify-stage">
      <div className="amplify-stage-intro"><span>03</span><div><h2>Where, when and how much?</h2><p>Recommendations are clear. Manual choices always win.</p></div></div>
      <fieldset className="amplify-platform-picker"><legend>Advertising platforms <small>{manualPlatforms ? "Manual selection" : "Recommended automatically"}</small></legend><div>{AMPLIFY_PROVIDER_CAPABILITIES.map((provider) => { const chosen = providerIds.includes(provider.providerId); const recommended = recommendedProviders(goal).includes(provider.providerId); const Icon = provider.Icon; return <button type="button" key={provider.providerId} disabled={!provider.advertisingAvailable} className={chosen ? "selected" : ""} onClick={() => toggleProvider(provider.providerId)}><span className="amplify-provider-icon"><Icon aria-hidden="true" /></span><span><b>{provider.displayName}</b><small>{!provider.advertisingAvailable ? provider.unavailableReason : recommended ? providerReasons[provider.providerId] : "Available for manual selection."}</small></span><i>{chosen ? "✓" : recommended ? "Recommended" : ""}</i></button>; })}</div><button type="button" className="text-button" onClick={() => { setManualPlatforms(false); setProviderIds(recommendedProviders(goal)); }}>Restore automatic recommendations</button></fieldset>
      <div className="amplify-field-grid"><label>Budget type<select value={budget.type} onChange={(event) => setBudget({ ...budget, type: event.target.value as AmplifyBudget["type"] })}><option value="daily">Daily budget</option><option value="lifetime">Lifetime budget</option></select></label><label>{budget.type === "daily" ? "Daily spending limit" : "Lifetime spending limit"}<div className="amplify-money"><select value={budget.currency} onChange={(event) => setBudget({ ...budget, currency: event.target.value as AmplifyBudget["currency"] })}><option>CAD</option><option>USD</option><option>GBP</option><option>EUR</option><option>AUD</option></select><input type="number" min="1" step="1" value={budget.amount} onChange={(event) => setBudget({ ...budget, amount: Number(event.target.value) })} /></div></label></div>
      <div className="amplify-field-grid"><label>Start · {schedule.timezone}<input type="datetime-local" value={schedule.startAt} onChange={(event) => setSchedule({ ...schedule, startAt: event.target.value })} /></label><label>End · {schedule.timezone}<input type="datetime-local" value={schedule.endAt} onChange={(event) => setSchedule({ ...schedule, endAt: event.target.value })} /></label></div>
      <label>Time zone<select value={schedule.timezone} onChange={(event) => setSchedule({ ...schedule, timezone: event.target.value })}><option value="America/Toronto">America/Toronto</option><option value="America/New_York">America/New_York</option><option value="America/Chicago">America/Chicago</option><option value="America/Denver">America/Denver</option><option value="America/Los_Angeles">America/Los_Angeles</option><option value="Europe/London">Europe/London</option><option value="Australia/Sydney">Australia/Sydney</option></select></label>
      <div className="amplify-spend-summary"><span>MAXIMUM TOTAL SPENDING</span><strong>{budget.currency} {maxSpend.toFixed(2)}</strong><p>{budget.type === "daily" ? `${budget.currency} ${Number(budget.amount || 0).toFixed(2)} per day across ${providerIds.length || 0} selected platform${providerIds.length === 1 ? "" : "s"}.` : "Lifetime maximum. EchoFlow will never increase it automatically."}</p></div>
      <details className="amplify-advanced"><summary>Advanced platform settings</summary><p>Platform budget splits, placements and tracking will become available after official advertising connections. Automatic scaling is off.</p></details>
    </div>}

    {step === 4 && draft && <div className="amplify-stage amplify-review-stage">
      <div className="amplify-stage-intro"><span>04</span><div><h2>Review and dry test</h2><p>Everything that affects delivery or spending is shown before submission.</p></div></div>
      <p className="amplify-safety-banner"><strong>Run Dry Test</strong><span>No advertisements will be launched and no money will be spent.</span></p>
      <div className="amplify-review-grid"><article><span>Brand</span><b>{brand.name}</b></article><article><span>Goal</span><b>{goals.find((item) => item.id === draft.payload.goal)?.label}</b></article><article><span>Offer</span><b>{draft.payload.offer}</b></article><article><span>Destination</span><b>{draft.payload.destination}</b></article><article><span>Audience</span><b>{draft.payload.audience.summary} · {draft.payload.audience.location}</b></article><article><span>Schedule</span><b>{draft.payload.schedule.startAt} to {draft.payload.schedule.endAt}<small>{draft.payload.schedule.timezone}</small></b></article><article><span>Budget</span><b>{draft.payload.budget.type === "daily" ? `${draft.payload.budget.currency} ${draft.payload.budget.amount.toFixed(2)} daily` : `${draft.payload.budget.currency} ${draft.payload.budget.amount.toFixed(2)} lifetime`}<small>{draft.payload.budget.currency} {draft.payload.budget.maximumSpend.toFixed(2)} maximum</small></b></article><article><span>Tracking</span><b>Not connected<small>Tracking is not claimed active.</small></b></article></div>
      <div className="amplify-creative-source-review"><span>SOURCE CREATIVE</span><div>{draft.payload.creativeSource.url && (draft.payload.creativeSource.mediaType === "video" ? <video src={draft.payload.creativeSource.url} controls playsInline /> : <img src={draft.payload.creativeSource.url} alt={`${draft.payload.creativeSource.label} source creative`} />)}<p><strong>{draft.payload.creativeSource.label}</strong><small>{draft.payload.creativeSource.detail}<br />The original source is unchanged.</small></p></div></div>
      <section className="amplify-variations"><header><span>PLATFORM VARIATIONS</span><p>Edit one version without changing the others.</p></header>{draft.payload.variations.map((variation) => { const provider = amplifyProvider(variation.providerId); const Icon = provider?.Icon; return <article key={variation.providerId}><div className="amplify-variation-head"><span className="amplify-provider-icon">{Icon && <Icon aria-hidden="true" />}</span><div><h3>{provider?.displayName}</h3><small>{variation.format} · {variation.placement}</small></div><span className="amplify-status review">Platform Review Required</span></div><label>Headline<input value={variation.headline} onChange={(event) => editVariation(variation.providerId, "headline", event.target.value)} /></label><label>Primary text<textarea rows={4} value={variation.body} onChange={(event) => editVariation(variation.providerId, "body", event.target.value)} /></label><label>Call to action<input value={variation.callToAction} onChange={(event) => editVariation(variation.providerId, "callToAction", event.target.value)} /></label><div className="amplify-variation-actions"><button type="button" onClick={() => regenerateVariation(variation.providerId)}>Regenerate</button><button type="button" onClick={() => setStep(1)}>Replace Media</button><button type="button" onClick={() => removePlatform(variation.providerId)}>Remove Platform</button><button type="button" onClick={() => restoreVariation(variation.providerId)}>Restore Recommended</button></div>{variation.manuallyEdited && <small className="amplify-manual-note">Manual edit preserved</small>}</article>; })}</section>
      <section className="amplify-preflight"><h3>Preflight status</h3><ul><li><span>✓</span> Required campaign fields present</li><li><span>✓</span> Maximum spending visible</li><li><span>!</span> Requires Compliance Review</li><li><span>!</span> Platform Review Required</li><li><span>○</span> Advertising accounts not connected</li></ul></section>
      <label className="amplify-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the brand, destination, audience, creative, platforms, schedule and maximum spending.</span></label>
      {dryResult && <section className={`amplify-dry-result ${dryResult.status}`} role="status"><span>{dryResult.status === "dry_test_passed" ? "✓" : "!"}</span><div><h3>{dryResult.status === "dry_test_passed" ? "Dry Test Passed" : "Validation Failed"}</h3><p>{dryResult.validationStatus}. No advertising platform was contacted.</p><ul>{dryResult.checks.map((check) => <li key={check.label}><b>{check.label}</b><span>{check.status.toUpperCase()} · {check.detail}</span></li>)}</ul></div></section>}
    </div>}

    {error && <p className="message error" role="alert">! {error}</p>}
    <footer className="amplify-stage-actions">{step > 1 && <button type="button" className="secondary" disabled={busy} onClick={() => { setError(""); setStep((current) => Math.max(1, current - 1)); }}>Back</button>}{step < 3 && <button type="button" className="primary" onClick={goNext}>Continue <span>→</span></button>}{step === 3 && <button type="button" className="primary" disabled={busy} onClick={prepareReview}>{busy ? "Preparing review…" : "Prepare Review"} <span>→</span></button>}{step === 4 && <button type="button" className="primary" disabled={busy || !dryRunEnabled} onClick={dryTest}>{busy ? "Running dry test…" : "Run Dry Test"} <span>→</span></button>}</footer>
  </section>;
}
