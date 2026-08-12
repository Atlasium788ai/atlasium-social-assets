"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

const MAX_BYTES = 20 * 1024 * 1024;

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploadKey, setUploadKey] = useState("");

  useEffect(() => {
    const hashKey = new URLSearchParams(window.location.hash.slice(1)).get("key");
    if (hashKey) {
      window.localStorage.setItem("atlasium-upload-key", hashKey);
      window.history.replaceState(null, "", window.location.pathname);
    }
    setUploadKey(hashKey || window.localStorage.getItem("atlasium-upload-key") || "");
  }, []);

  function choose(next: File | undefined) {
    setUrl("");
    setCopied(false);
    setMessage("");
    if (!next) return;
    if (!next.type.startsWith("image/")) {
      setMessage("Please choose an image from your photo library.");
      return;
    }
    if (next.size > MAX_BYTES) {
      setMessage("That image is over the 20 MB upload limit.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }

  async function upload() {
    if (!file || uploading) return;
    setUploading(true);
    setMessage("");
    setCopied(false);

    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "X-Upload-Key": uploadKey },
        body: form,
      });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Upload failed.");
      setUrl(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function copyUrl() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    choose(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    choose(event.dataTransfer.files?.[0]);
  }

  return (
    <main>
      <header className="brand" aria-label="Atlasium">
        <span className="brand-mark" aria-hidden="true">A</span>
        <span>ATLASIUM</span>
      </header>

      <section className="card">
        <div className="intro">
          <p className="eyebrow">SOCIAL ASSET LIBRARY</p>
          <h1>Upload. Copy. Post.</h1>
          <p className="subtitle">Turn a photo into a permanent public link in seconds.</p>
        </div>

        <input ref={inputRef} className="visually-hidden" type="file" accept="image/*" onChange={onInput} />

        <button
          className={`picker ${preview ? "has-preview" : ""}`}
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Selected upload preview" />
          ) : (
            <span className="picker-empty">
              <span className="plus" aria-hidden="true">+</span>
              <strong>Choose a photo</strong>
              <small>JPG, PNG, WebP, GIF or HEIC · up to 20 MB</small>
            </span>
          )}
        </button>

        {file && !url && (
          <div className="file-row">
            <span>{file.name}</span>
            <button type="button" onClick={() => inputRef.current?.click()}>Change</button>
          </div>
        )}

        {message && <p className="message error" role="alert">{message}</p>}

        {!url ? (
          <button className="primary" type="button" disabled={!file || !uploadKey || uploading} onClick={upload}>
            {uploading ? <><span className="spinner" /> Uploading…</> : "Upload image"}
          </button>
        ) : (
          <div className="result" aria-live="polite">
            <div className="success"><span aria-hidden="true">✓</span> Upload complete</div>
            <label htmlFor="public-url">Permanent public URL</label>
            <input id="public-url" value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
            <button className="primary" type="button" onClick={copyUrl}>{copied ? "Copied!" : "Copy URL"}</button>
            <button className="secondary" type="button" onClick={() => { setFile(null); setPreview(""); setUrl(""); setCopied(false); }}>
              Upload another
            </button>
          </div>
        )}
      </section>

      {!uploadKey && <p className="access-warning" role="alert">Open your private Atlasium uploader link to enable uploads.</p>}

      <footer>Public links are permanent and ready for Claude or Buffer.</footer>
    </main>
  );
}
