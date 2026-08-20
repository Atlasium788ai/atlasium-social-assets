"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ContentType = "blog" | "newsletter";
type SaveState = "saved" | "saving" | "unsaved" | "failed";
type Section = { heading: string; body: string };
type Draft = {
  id: string; brandId: string; contentType: "social" | ContentType; title: string; status: "draft" | "completed";
  prompt: string; settings: Record<string, unknown>; payload: Record<string, unknown>; featuredImageUrl: string | null;
  sourceDraftId: string | null; createdAt: string; updatedAt: string;
};
type LibraryRecord = Pick<Draft, "id" | "brandId" | "contentType" | "title" | "status" | "updatedAt"> & { source?: string };
type Asset = { id: string; brandId: string; url: string; mediaType: string; createdAt: string };
type Workspace = { drafts: Draft[]; library: LibraryRecord[]; assets: Asset[]; publishingConnections: { blog: string; newsletter: string } };

const blogPrompt = "Tell us what the blog should be about, who it is for and what it should accomplish.";
const newsletterPrompt = "Tell us what the newsletter should communicate, who should receive it and what action they should take.";

function text(input: unknown) { return String(input ?? ""); }
function list(input: unknown) { return Array.isArray(input) ? input.map(text) : []; }
function sections(input: unknown) { return Array.isArray(input) ? input.map((item) => ({ heading: text((item as Section).heading), body: text((item as Section).body) })) : []; }
function formatUpdated(input: string) { return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(input)); }

function plainText(draft: Draft) {
  const payload = draft.payload;
  if (draft.contentType === "newsletter") return text(payload.plainText);
  return [payload.title, payload.subtitle, payload.introduction, ...sections(payload.sections).flatMap((section) => [section.heading, section.body]), payload.conclusion, payload.callToAction].map(text).filter(Boolean).join("\n\n");
}

function escapeHtml(input: unknown) { return text(input).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function blogHtml(draft: Draft) {
  const payload = draft.payload;
  return `<article><h1>${escapeHtml(payload.title)}</h1>${payload.subtitle ? `<p><em>${escapeHtml(payload.subtitle)}</em></p>` : ""}<p>${escapeHtml(payload.introduction)}</p>${sections(payload.sections).map((section) => `<section><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body).replace(/\n/g, "<br>")}</p></section>`).join("")}<p>${escapeHtml(payload.conclusion)}</p><p><strong>${escapeHtml(payload.callToAction)}</strong></p></article>`;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export function EchoContentStudio({ contentType, brandId, brandName, authKey, onRepurposeSocial }: { contentType: ContentType; brandId: string; brandName: string; authKey: string; onRepurposeSocial(prompt: string): void }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({ audience: "", topic: "", outcome: "", length: "Standard", tone: "", offer: "", seoKeyword: "", assets: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [selectedSection, setSelectedSection] = useState("");
  const [libraryType, setLibraryType] = useState<"all" | "social" | ContentType>("all");
  const [libraryStatus, setLibraryStatus] = useState<"all" | "draft" | "completed">("all");
  const saveTimer = useRef<number | null>(null);

  const headers = useCallback((json = false) => ({ "X-Upload-Key": authKey, "X-Brand-ID": brandId, ...(json ? { "Content-Type": "application/json" } : {}) }), [authKey, brandId]);

  const loadWorkspace = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/echo/content/workspace", { headers: headers() });
    const data = await response.json() as Workspace & { error?: string };
    if (!response.ok) throw new Error(data.error || "Could not load ECHO content.");
    setWorkspace(data);
    const preferred = data.drafts.find((draft) => draft.id === preferredId && draft.contentType === contentType);
    setActiveDraft((current) => preferred || data.drafts.find((draft) => draft.id === current?.id && draft.contentType === contentType) || null);
  }, [contentType, headers]);

  useEffect(() => {
    // This keyed workspace boundary intentionally clears the previous brand before loading the next one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspace(null); setActiveDraft(null); setPrompt(""); setError(""); setSaveState("saved"); setSelectedSection("");
    void loadWorkspace().catch((cause: Error) => setError(cause.message));
  }, [brandId, contentType, loadWorkspace]);

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/echo/content/drafts", { method: "POST", headers: headers(true), body: JSON.stringify({ brandId, contentType, prompt, settings }) });
      const data = await response.json() as { draft?: Draft; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || `Could not create the ${contentType}.`);
      setActiveDraft(data.draft); setPrompt(""); setSaveState("saved"); await loadWorkspace(data.draft.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Could not create the ${contentType}.`); }
    finally { setBusy(false); }
  }

  function updatePayload(field: string, next: unknown) {
    setActiveDraft((current) => current ? { ...current, payload: { ...current.payload, [field]: next } } : current);
    setSaveState("unsaved");
  }

  function updateSection(index: number, field: keyof Section, next: string) {
    if (!activeDraft) return;
    const nextSections = sections(activeDraft.payload.sections).map((section, position) => position === index ? { ...section, [field]: next } : section);
    updatePayload("sections", nextSections);
  }

  const save = useCallback(async (draft: Draft, announce = true) => {
    setSaveState("saving");
    try {
      const response = await fetch(`/api/echo/content/drafts/${encodeURIComponent(draft.id)}`, { method: "PATCH", headers: headers(true), body: JSON.stringify({ payload: draft.payload, status: draft.status, featuredImageUrl: draft.featuredImageUrl }) });
      const data = await response.json() as { draft?: Draft; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "Save failed.");
      const savedDraft = data.draft;
      setActiveDraft((current) => current?.id === savedDraft.id ? savedDraft : current); setSaveState("saved");
      if (announce) await loadWorkspace(savedDraft.id);
    } catch (cause) { setSaveState("failed"); setError(cause instanceof Error ? cause.message : "Save failed."); }
  }, [headers, loadWorkspace]);

  useEffect(() => {
    if (!activeDraft || saveState !== "unsaved") return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void save(activeDraft, false); }, 850);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [activeDraft, save, saveState]);

  async function action(operation: string, sectionOverride?: string) {
    if (!activeDraft || busy) return;
    const section = sectionOverride || selectedSection;
    if (!section && operation !== "undo") { setError("Select a section first."); return; }
    setBusy(true); setError("");
    try {
      if (saveState === "unsaved") await save(activeDraft, false);
      const endpoint = operation === "undo" ? "undo" : "revise";
      const response = await fetch(`/api/echo/content/drafts/${encodeURIComponent(activeDraft.id)}/${endpoint}`, { method: "POST", headers: headers(true), body: JSON.stringify({ brandId, operation, section, tone: settings.tone }) });
      const data = await response.json() as { draft?: Draft; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "Could not revise this section.");
      setActiveDraft(data.draft); setSaveState("saved"); await loadWorkspace(data.draft.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not revise this section."); }
    finally { setBusy(false); }
  }

  async function duplicateDraft() {
    if (!activeDraft || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/echo/content/drafts/${encodeURIComponent(activeDraft.id)}/duplicate`, { method: "POST", headers: headers(true), body: JSON.stringify({ brandId }) });
      const data = await response.json() as { draft?: Draft; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "Could not duplicate this draft.");
      setActiveDraft(data.draft); setSaveState("saved"); await loadWorkspace(data.draft.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not duplicate this draft."); }
    finally { setBusy(false); }
  }

  async function deleteDraft() {
    if (!activeDraft || !window.confirm(`Delete “${activeDraft.title}”? This cannot be undone.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/echo/content/drafts/${encodeURIComponent(activeDraft.id)}`, { method: "DELETE", headers: headers() });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not delete this draft.");
      setActiveDraft(null); await loadWorkspace();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete this draft."); }
    finally { setBusy(false); }
  }

  async function repurpose(targetType: "social" | "newsletter") {
    if (!activeDraft || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/echo/content/drafts/${encodeURIComponent(activeDraft.id)}/repurpose`, { method: "POST", headers: headers(true), body: JSON.stringify({ brandId, targetType }) });
      const data = await response.json() as { draft?: Draft; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "Could not repurpose this draft.");
      await loadWorkspace(targetType === "newsletter" ? data.draft.id : activeDraft.id);
      if (targetType === "social") onRepurposeSocial(text(data.draft.payload.prompt));
      else setActiveDraft(data.draft);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not repurpose this draft."); }
    finally { setBusy(false); }
  }

  async function generateImage() {
    if (!activeDraft || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/echo/content/drafts/${encodeURIComponent(activeDraft.id)}/image`, { method: "POST", headers: headers(true), body: JSON.stringify({ brandId }) });
      const data = await response.json() as { draft?: Draft; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "Could not generate the featured image.");
      setActiveDraft(data.draft); await loadWorkspace(data.draft.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not generate the featured image."); }
    finally { setBusy(false); }
  }

  const filteredLibrary = useMemo(() => (workspace?.library || []).filter((item) => (libraryType === "all" || item.contentType === libraryType) && (libraryStatus === "all" || item.status === libraryStatus)), [workspace, libraryType, libraryStatus]);
  const exportHtml = activeDraft ? activeDraft.contentType === "newsletter" ? text(activeDraft.payload.html) : blogHtml(activeDraft) : "";
  const slug = activeDraft ? text(activeDraft.payload.slug) || activeDraft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "draft";

  return <div className="echo-content-studio">
    <section className="content-studio-head">
      <div><p className="eyebrow">{contentType.toUpperCase()} STUDIO · {brandName.toUpperCase()}</p><h1>{contentType === "blog" ? "Create a blog." : "Create a newsletter."}</h1><p>Draft, refine and export in {brandName}&apos;s voice. Nothing is published or sent.</p></div>
      <div className="connection-status"><span>Publishing Connections</span><b>Not Configured</b><small>Future connection-ready · no live destination</small></div>
    </section>

    <section className="content-creator card">
      <label className="content-prompt-label">{contentType === "blog" ? blogPrompt : newsletterPrompt}<textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={contentType === "blog" ? "Example: Explain how consistent follow-up helps Toronto service businesses turn more inquiries into conversations." : "Example: Share this month’s practical update with business owners and invite them to book an assessment."} /></label>
      <div className="content-simple-settings">
        <label>Audience<input value={settings.audience} onChange={(event) => setSettings((current) => ({ ...current, audience: event.target.value }))} placeholder={brandName + " audience"} /></label>
        <label>{contentType === "blog" ? "Primary topic" : "Purpose"}<input value={settings.topic} onChange={(event) => setSettings((current) => ({ ...current, topic: event.target.value }))} /></label>
        <label>Desired outcome<input value={settings.outcome} onChange={(event) => setSettings((current) => ({ ...current, outcome: event.target.value }))} /></label>
        <label>Approximate length<select value={settings.length} onChange={(event) => setSettings((current) => ({ ...current, length: event.target.value }))}><option>Short</option><option>Standard</option><option>Long</option></select></label>
      </div>
      <details className="content-advanced"><summary>Advanced settings</summary><div className="content-simple-settings"><label>Tone<input value={settings.tone} onChange={(event) => setSettings((current) => ({ ...current, tone: event.target.value }))} /></label><label>Offer or call to action<input value={settings.offer} onChange={(event) => setSettings((current) => ({ ...current, offer: event.target.value }))} /></label>{contentType === "blog" && <label>SEO keyword<input value={settings.seoKeyword} onChange={(event) => setSettings((current) => ({ ...current, seoKeyword: event.target.value }))} /></label>}<label>Supporting brand assets<input value={settings.assets} onChange={(event) => setSettings((current) => ({ ...current, assets: event.target.value }))} /></label></div></details>
      <button className="primary content-generate" type="button" disabled={busy || !prompt.trim()} onClick={generate}>{busy && !activeDraft ? "Creating…" : `Create ${contentType === "blog" ? "Blog Draft" : "Newsletter Draft"}`} <span>→</span></button>
    </section>

    {error && <p className="message error" role="alert">! {error}</p>}

    {activeDraft && <section className="content-editor card">
      <header className="content-editor-head"><div><span>{activeDraft.contentType.toUpperCase()} DRAFT</span><h2>{activeDraft.title}</h2><small>Updated {formatUpdated(activeDraft.updatedAt)} · {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved changes" : "Save failed"}</small></div><select aria-label="Open another draft" value={activeDraft.id} onChange={(event) => setActiveDraft(workspace?.drafts.find((draft) => draft.id === event.target.value) || activeDraft)}>{workspace?.drafts.filter((draft) => draft.contentType === contentType).map((draft) => <option value={draft.id} key={draft.id}>{draft.title}</option>)}</select></header>

      <div className="revision-toolbar" aria-label="AI editing actions"><button onClick={() => action("regenerate")} disabled={busy}>Regenerate section</button><button onClick={() => action("shorten")} disabled={busy}>Shorten</button><button onClick={() => action("expand")} disabled={busy}>Expand</button><button onClick={() => action("change_tone")} disabled={busy}>Change tone</button><button onClick={() => action("improve_headline", contentType === "blog" ? "title" : "headline")} disabled={busy}>Improve headline</button><button onClick={() => action("improve_cta", "callToAction")} disabled={busy}>Improve CTA</button><button onClick={() => action("undo")} disabled={busy}>Undo AI revision</button></div>

      <div className="editor-fields">
        {contentType === "blog" ? <>
          <EditableField label="Blog title" path="title" selected={selectedSection} onSelect={setSelectedSection}><input value={text(activeDraft.payload.title)} onChange={(event) => updatePayload("title", event.target.value)} /></EditableField>
          <EditableField label="Subtitle" path="subtitle" selected={selectedSection} onSelect={setSelectedSection}><input value={text(activeDraft.payload.subtitle)} onChange={(event) => updatePayload("subtitle", event.target.value)} /></EditableField>
          <EditableField label="Introduction" path="introduction" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={6} value={text(activeDraft.payload.introduction)} onChange={(event) => updatePayload("introduction", event.target.value)} /></EditableField>
        </> : <>
          <EditableField label="Subject line options" path="subjectLines.0" selected={selectedSection} onSelect={setSelectedSection}><div className="subject-lines">{list(activeDraft.payload.subjectLines).map((subject, index) => <input key={index} aria-label={`Subject line ${index + 1}`} value={subject} onFocus={() => setSelectedSection(`subjectLines.${index}`)} onChange={(event) => { const next = list(activeDraft.payload.subjectLines); next[index] = event.target.value; updatePayload("subjectLines", next); }} />)}</div></EditableField>
          <EditableField label="Preview text" path="previewText" selected={selectedSection} onSelect={setSelectedSection}><input value={text(activeDraft.payload.previewText)} onChange={(event) => updatePayload("previewText", event.target.value)} /></EditableField>
          <EditableField label="Newsletter headline" path="headline" selected={selectedSection} onSelect={setSelectedSection}><input value={text(activeDraft.payload.headline)} onChange={(event) => updatePayload("headline", event.target.value)} /></EditableField>
          <EditableField label="Opening" path="opening" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={5} value={text(activeDraft.payload.opening)} onChange={(event) => updatePayload("opening", event.target.value)} /></EditableField>
        </>}

        <div className="document-sections"><span>ARTICLE SECTIONS</span>{sections(activeDraft.payload.sections).map((section, index) => <article key={index}><EditableField label={`Section ${index + 1} heading`} path={`sections.${index}.heading`} selected={selectedSection} onSelect={setSelectedSection}><input value={section.heading} onChange={(event) => updateSection(index, "heading", event.target.value)} /></EditableField><EditableField label={`Section ${index + 1} body`} path={`sections.${index}.body`} selected={selectedSection} onSelect={setSelectedSection}><textarea rows={8} value={section.body} onChange={(event) => updateSection(index, "body", event.target.value)} /></EditableField></article>)}</div>

        {contentType === "blog" ? <>
          <EditableField label="Conclusion" path="conclusion" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={5} value={text(activeDraft.payload.conclusion)} onChange={(event) => updatePayload("conclusion", event.target.value)} /></EditableField>
          <EditableField label="Call to action" path="callToAction" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={3} value={text(activeDraft.payload.callToAction)} onChange={(event) => updatePayload("callToAction", event.target.value)} /></EditableField>
          <div className="seo-grid"><EditableField label="Excerpt" path="excerpt" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={4} value={text(activeDraft.payload.excerpt)} onChange={(event) => updatePayload("excerpt", event.target.value)} /></EditableField><EditableField label="URL slug" path="slug" selected={selectedSection} onSelect={setSelectedSection}><input value={text(activeDraft.payload.slug)} onChange={(event) => updatePayload("slug", event.target.value)} /></EditableField><EditableField label="Meta title" path="metaTitle" selected={selectedSection} onSelect={setSelectedSection}><input value={text(activeDraft.payload.metaTitle)} onChange={(event) => updatePayload("metaTitle", event.target.value)} /></EditableField><EditableField label="Meta description" path="metaDescription" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={3} value={text(activeDraft.payload.metaDescription)} onChange={(event) => updatePayload("metaDescription", event.target.value)} /></EditableField><EditableField label="Categories" path="categories" selected={selectedSection} onSelect={setSelectedSection}><input value={list(activeDraft.payload.categories).join(", ")} onChange={(event) => updatePayload("categories", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></EditableField><EditableField label="Tags" path="tags" selected={selectedSection} onSelect={setSelectedSection}><input value={list(activeDraft.payload.tags).join(", ")} onChange={(event) => updatePayload("tags", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></EditableField></div>
          <EditableField label="Featured-image concept" path="featuredImageConcept" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={3} value={text(activeDraft.payload.featuredImageConcept)} onChange={(event) => updatePayload("featuredImageConcept", event.target.value)} /></EditableField>
          <EditableField label="Featured-image alt text" path="featuredImageAltText" selected={selectedSection} onSelect={setSelectedSection}><input value={text(activeDraft.payload.featuredImageAltText)} onChange={(event) => updatePayload("featuredImageAltText", event.target.value)} /></EditableField>
        </> : <>
          <EditableField label="Call to action" path="callToAction" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={3} value={text(activeDraft.payload.callToAction)} onChange={(event) => updatePayload("callToAction", event.target.value)} /></EditableField>
          <EditableField label="Closing" path="closing" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={4} value={text(activeDraft.payload.closing)} onChange={(event) => updatePayload("closing", event.target.value)} /></EditableField>
          <EditableField label="Plain-text version" path="plainText" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={12} value={text(activeDraft.payload.plainText)} onChange={(event) => updatePayload("plainText", event.target.value)} /></EditableField>
          <EditableField label="Clean email-safe HTML" path="html" selected={selectedSection} onSelect={setSelectedSection}><textarea rows={10} value={text(activeDraft.payload.html)} onChange={(event) => updatePayload("html", event.target.value)} /></EditableField>
          <div className="email-preview"><span>EMAIL PREVIEW · SCRIPTS DISABLED</span><iframe title="Sanitized newsletter HTML preview" sandbox="" srcDoc={text(activeDraft.payload.html)} /></div>
        </>}
      </div>

      <div className="featured-image-tools"><div>{activeDraft.featuredImageUrl ? <img src={activeDraft.featuredImageUrl} alt={text(activeDraft.payload.featuredImageAltText) || "Attached featured image"} /> : <span>NO FEATURED IMAGE</span>}</div><label>Attach an existing ECHO image<select value={activeDraft.featuredImageUrl || ""} onChange={(event) => { setActiveDraft((current) => current ? { ...current, featuredImageUrl: event.target.value || null } : current); setSaveState("unsaved"); }}><option value="">No image attached</option>{workspace?.assets.map((asset) => <option value={asset.url} key={asset.id}>ECHO image · {formatUpdated(asset.createdAt)}</option>)}</select></label><button type="button" onClick={generateImage} disabled={busy}>Generate new image</button></div>

      <footer className="content-editor-actions"><button onClick={() => activeDraft && save(activeDraft)}>Save draft</button><button onClick={duplicateDraft}>Duplicate</button><button onClick={() => navigator.clipboard.writeText(plainText(activeDraft))}>Copy content</button><button onClick={() => download(`${slug}.txt`, plainText(activeDraft), "text/plain")}>Export plain text</button><button onClick={() => download(`${slug}.html`, exportHtml, "text/html")}>Export clean HTML</button><button onClick={() => { setActiveDraft((current) => current ? { ...current, status: current.status === "completed" ? "draft" : "completed" } : current); setSaveState("unsaved"); }}>{activeDraft.status === "completed" ? "Return to draft" : "Mark completed"}</button><button className="danger-button" onClick={deleteDraft}>Delete</button></footer>

      <div className="repurpose-actions"><span>REPURPOSE AS A NEW DRAFT</span>{activeDraft.contentType === "blog" && <button onClick={() => repurpose("newsletter")}>Turn Blog into Newsletter</button>}<button onClick={() => repurpose("social")}>Turn {activeDraft.contentType === "blog" ? "Blog" : "Newsletter"} into Social Campaign</button></div>
    </section>}

    <section className="content-library card"><header><div><p className="eyebrow">ECHO CONTENT LIBRARY</p><h2>Everything {brandName} is creating.</h2></div><div className="library-filters"><label>Content<select value={libraryType} onChange={(event) => setLibraryType(event.target.value as typeof libraryType)}><option value="all">All</option><option value="social">Social</option><option value="blog">Blog</option><option value="newsletter">Newsletter</option></select></label><label>Status<select value={libraryStatus} onChange={(event) => setLibraryStatus(event.target.value as typeof libraryStatus)}><option value="all">All</option><option value="draft">Draft</option><option value="completed">Completed</option></select></label><label>Brand<select disabled><option>{brandName}</option></select></label></div></header><div className="library-list">{filteredLibrary.length ? filteredLibrary.map((item) => <button type="button" key={`${item.source || "content"}-${item.id}`} onClick={() => { const draft = workspace?.drafts.find((candidate) => candidate.id === item.id); if (draft && draft.contentType === contentType) setActiveDraft(draft); }}><span className={`content-type-badge ${item.contentType}`}>{item.contentType}</span><b>{item.title}</b><small>{brandName}</small><small>{formatUpdated(item.updatedAt)}</small><i>{item.status}</i></button>) : <p className="empty">No matching content yet.</p>}</div></section>
  </div>;
}

function EditableField({ label, path, selected, onSelect, children }: { label: string; path: string; selected: string; onSelect(path: string): void; children: React.ReactNode }) {
  return <div className={selected === path ? "editable-field selected" : "editable-field"}><span>{label}<button type="button" onClick={() => onSelect(path)}>{selected === path ? "SELECTED FOR AI EDITING" : "Select for AI editing"}</button></span>{children}</div>;
}
