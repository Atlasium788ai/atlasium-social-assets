"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";

type PostDraft = {
  id: string;
  brandId: string;
  contentType: "social";
  title: string;
  status: "draft" | "completed";
  prompt: string;
  payload: { title?: string; caption?: string; imageConcept?: string; platforms?: string[] };
  featuredImageUrl: string | null;
  updatedAt: string;
};

type SocialWorkspace = { socialDrafts?: PostDraft[]; error?: string };

const networks = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["linkedin", "LinkedIn"],
  ["tiktok", "TikTok"],
  ["threads", "Threads"],
  ["x", "X"],
  ["youtube", "YouTube"],
  ["pinterest", "Pinterest"],
  ["bluesky", "Bluesky"],
] as const;

function dateLabel(date: string) {
  const time = new Date(date);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export function EchoSocialComposer({ brandId, brandName, authKey }: { brandId: string; brandName: string; authKey: string }) {
  const [savedPosts, setSavedPosts] = useState<PostDraft[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [idea, setIdea] = useState("");
  const [imageConcept, setImageConcept] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["facebook", "instagram", "linkedin", "tiktok"]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unsaved, setUnsaved] = useState(false);
  const headers = useCallback((json = false) => ({
    "X-Upload-Key": authKey, "X-Brand-ID": brandId, ...(json ? { "Content-Type": "application/json" } : {}),
  }), [authKey, brandId]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/echo/content/workspace", { headers: headers() });
    const data = await response.json() as SocialWorkspace;
    if (!response.ok) throw new Error(data.error || "Could not load saved social posts.");
    setSavedPosts((data.socialDrafts || []).filter((post) => post.brandId === brandId && post.contentType === "social"));
  }, [headers, brandId]);

  useEffect(() => {
    let mounted = true;
    // Reset every field when the selected brand changes. Never show another brand's draft.
    void Promise.resolve().then(() => {
      if (!mounted) return;
      setSavedPosts([]); setActiveId(null); setTitle(""); setCaption(""); setIdea("");
      setImageConcept(""); setImageUrl(""); setPlatforms(["facebook", "instagram", "linkedin", "tiktok"]);
      setMessage(""); setError(""); setUnsaved(false); setLoading(true);
      return refresh();
    }).catch((cause: Error) => { if (mounted) setError(cause.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [brandId, refresh]);

  function load(post: PostDraft) {
    if (unsaved && !window.confirm("Discard unsaved changes and open this saved post?")) return;
    setActiveId(post.id);
    setTitle(String(post.payload.title || post.title));
    setCaption(String(post.payload.caption || ""));
    setImageConcept(String(post.payload.imageConcept || ""));
    setImageUrl(post.featuredImageUrl || "");
    setPlatforms(Array.isArray(post.payload.platforms) ? post.payload.platforms : []);
    setIdea("");
    setError(""); setMessage("");
    setUnsaved(false);
  }

  function clear() {
    if (unsaved && !window.confirm("Discard changes and start a new post?")) return;
    setActiveId(null); setTitle(""); setCaption(""); setImageConcept(""); setImageUrl("");
    setIdea(""); setPlatforms(["facebook", "instagram", "linkedin", "tiktok"]);
    setError(""); setMessage(""); setUnsaved(false);
  }

  function togglePlatform(network: string) {
    setPlatforms((current) => current.includes(network) ? current.filter((name) => name !== network) : [...current, network]);
    setUnsaved(true);
  }

  async function save() {
    if (busy) return;
    if (!caption.trim()) { setError("Write your post first."); return; }
    setBusy(true); setError(""); setMessage("");
    const payload = { title: title.trim(), caption: caption.trim(), imageConcept: imageConcept.trim(), platforms };
    try {
      const url = activeId ? `/api/echo/content/drafts/${encodeURIComponent(activeId)}` : "/api/echo/content/drafts";
      const body = activeId
        ? { brandId, payload, featuredImageUrl: imageUrl || null, status: "draft" }
        : { brandId, contentType: "social", prompt: "", payload, featuredImageUrl: imageUrl || null };
      const response = await fetch(url, {
        method: activeId ? "PATCH" : "POST", headers: headers(true), body: JSON.stringify(body),
      });
      const result = await response.json() as { draft?: PostDraft; error?: string };
      if (!response.ok || !result.draft) throw new Error(result.error || "Could not save your post.");
      setActiveId(result.draft.id);
      setTitle(String(result.draft.payload.title || result.draft.title));
      setUnsaved(false);
      await refresh();
      setMessage("Post saved under " + brandName + ". Nothing was published.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your post."); }
    finally { setBusy(false); }
  }

  async function generate() {
    if (busy) return;
    if (!idea.trim()) { setError("Describe the post you want to create."); return; }
    if (unsaved && !window.confirm("Generating will open a new post. Continue without saving these edits?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/echo/content/drafts", {
        method: "POST", headers: headers(true),
        body: JSON.stringify({ brandId, contentType: "social", mode: "generate", prompt: idea.trim(), payload: { platforms } }),
      });
      const result = await response.json() as { draft?: PostDraft; error?: string };
      if (!response.ok || !result.draft) throw new Error(result.error || "Could not generate your post.");
      const post = result.draft;
      setActiveId(post.id); setTitle(String(post.payload.title || post.title));
      setCaption(String(post.payload.caption || "")); setImageConcept(String(post.payload.imageConcept || ""));
      setImageUrl(post.featuredImageUrl || ""); setPlatforms(post.payload.platforms || platforms);
      setIdea(""); setUnsaved(false);
      await refresh();
      setMessage("One post generated and saved as a draft. Review and edit it before use.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI writing is unavailable. You can still type and save your post."); }
    finally { setBusy(false); }
  }

  async function upload(file?: File) {
    if (!file || busy) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError("Choose a JPG, PNG or WebP image under 10 MB."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/echo/content/media", { method: "POST", headers: headers(), body: form });
      const result = await response.json() as { imageUrl?: string; error?: string };
      if (!response.ok || !result.imageUrl) throw new Error(result.error || "Image upload failed.");
      setImageUrl(result.imageUrl);
      setUnsaved(true);
      setMessage("Image attached. Save the post to keep it with this draft.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Image upload failed."); }
    finally { setBusy(false); }
  }

  async function removePost() {
    if (!activeId || busy || !window.confirm("Delete this saved social post draft?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/echo/content/drafts/${encodeURIComponent(activeId)}`, {
        method: "DELETE", headers: headers(),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not delete the draft.");
      setActiveId(null); setTitle(""); setCaption(""); setImageUrl(""); setImageConcept("");
      setIdea(""); setUnsaved(false);
      await refresh();
      setMessage("Draft deleted. Nothing was published.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete the draft."); }
    finally { setBusy(false); }
  }

  return <section className="echo-post-builder card" aria-label="Social post builder">
    <header className="echo-post-builder-head">
      <div><p className="eyebrow">ECHO · SOCIAL</p><h2>Build a post</h2><p>Write, design and save for {brandName}. You do not need to connect any social account.</p></div>
      <button type="button" className="secondary" disabled={busy} onClick={clear}>+ New post</button>
    </header>
    {error && <p className="message error" role="alert">{error}</p>}
    {message && <p className="message ok" role="status">{message}</p>}

    <div className="echo-post-composer-grid">
      <div className="echo-post-edit">
        <label htmlFor="echo-post-title">Post title (internal)</label>
        <input id="echo-post-title" placeholder="Give this post a name" value={title} maxLength={180}
          onChange={(event) => { setTitle(event.target.value); setUnsaved(true); }} />

        <label htmlFor="echo-post-text">Post text</label>
        <textarea id="echo-post-text" className="prompt-box" rows={7} maxLength={8000}
          placeholder="Write your post here. Nothing will publish automatically."
          value={caption} onChange={(event) => { setCaption(event.target.value); setUnsaved(true); }} />
        <small>{caption.length.toLocaleString()} characters</small>

        <label>Platforms for this draft</label>
        <div className="echo-post-platforms">{networks.map(([id, label]) =>
          <label key={id}><input type="checkbox" checked={platforms.includes(id)} onChange={() => togglePlatform(id)} />{label}</label>)}
        </div>

        <label htmlFor="echo-post-image-concept">Visual direction (optional)</label>
        <input id="echo-post-image-concept" value={imageConcept} maxLength={1200}
          placeholder="Describe the artwork or image you want"
          onChange={(event) => { setImageConcept(event.target.value); setUnsaved(true); }} />

        <label htmlFor="echo-post-image">Attach a post image (optional)</label>
        <input id="echo-post-image" type="file" accept="image/png,image/jpeg,image/webp"
          disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
        {imageUrl && <button type="button" className="text-button" onClick={() => { setImageUrl(""); setUnsaved(true); }}>Remove image from post</button>}

        <button className="primary" type="button" onClick={save} disabled={busy || !caption.trim()}>
          {busy ? "Working…" : activeId ? "Save changes" : "Save post as draft"}
        </button>
        <p className="echo-post-notice">{unsaved ? "Unsaved changes" : activeId ? "Saved draft" : "New post"} · No scheduling or publishing</p>

        <details className="echo-post-idea">
          <summary>Or create post text from an idea with AI</summary>
          <label htmlFor="echo-post-idea">What should this post say?</label>
          <textarea id="echo-post-idea" rows={3} value={idea} onChange={(event) => setIdea(event.target.value)}
            placeholder="Describe your topic, audience and desired outcome." />
          <button type="button" className="secondary" disabled={busy || !idea.trim()} onClick={generate}>Generate one draft</button>
          <p className="wizard-help">AI requires your existing API configuration. Manual writing and saving work without it.</p>
        </details>
        {activeId && <button type="button" className="text-button echo-post-delete" onClick={removePost} disabled={busy}>Delete this draft</button>}
      </div>

      <aside className="echo-post-preview" aria-label="Live post preview">
        <p className="eyebrow">PREVIEW · NOT PUBLISHED</p>
        <div className="echo-post-preview-card">
          <b>{brandName}</b>
          {imageUrl ? <img src={imageUrl} alt="Attached post artwork" /> : <div className="echo-post-empty-image">Post image preview</div>}
          <p>{caption || "Your post will appear here as you type."}</p>
          <small>{platforms.length ? platforms.join(" · ") : "No platforms selected yet"}</small>
        </div>
      </aside>
    </div>

    <section className="echo-post-library" aria-label="Saved social posts">
      <header><h3>Saved posts for {brandName}</h3><small>{savedPosts.length} draft{savedPosts.length === 1 ? "" : "s"}</small></header>
      {loading ? <p>Loading saved posts…</p> : savedPosts.length ? <div className="echo-post-library-list">
        {savedPosts.map((post) => <button type="button" key={post.id}
          className={activeId === post.id ? "active" : ""}
          onClick={() => load(post)}>
          <b>{String(post.payload.title || post.title)}</b>
          <span>{String(post.payload.caption || "").slice(0, 110) || "Draft from another content type"}</span>
          <small>{dateLabel(post.updatedAt)} · {post.status}</small>
        </button>)}
      </div> : <p className="empty">No saved posts for this brand yet. Create your first post above.</p>}
    </section>
  </section>;
}
