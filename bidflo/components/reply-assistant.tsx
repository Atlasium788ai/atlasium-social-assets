"use client";

import { useEffect, useState } from "react";
import { REPLY_LABELS, REPLY_TONES, type ReplyTone } from "@/lib/reply-suggestions";

type Version = { text: string; source: "ai" | "starter" };
type Track = { versions: Version[]; index: number };
type Tracks = Record<ReplyTone, Track>;
type ServiceReply = { tone: ReplyTone; text: string; source: "ai" | "starter" };
const INBOX_URL = "https://www.upwork.com/ab/messages/rooms/";

function emptyTracks(): Tracks {
  return {
    direct: { versions: [], index: 0 },
    consultative: { versions: [], index: 0 },
    friendly: { versions: [], index: 0 },
  };
}
function restoredTracks(value: unknown): Tracks | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, { versions?: unknown; index?: unknown }>;
  const result = emptyTracks();
  for (const tone of REPLY_TONES) {
    const versions = data[tone]?.versions;
    if (!Array.isArray(versions) || versions.length < 1 || versions.length > 100) return null;
    const valid = versions.every((item: unknown) => item && typeof item === "object"
      && typeof (item as Version).text === "string"
      && (item as Version).text.length <= 1300
      && ((item as Version).source === "ai" || (item as Version).source === "starter"));
    if (!valid) return null;
    const index = typeof data[tone].index === "number" ? data[tone].index : 0;
    result[tone] = { versions: versions as Version[], index: Math.max(0, Math.min(versions.length - 1, Math.trunc(index))) };
  }
  return result;
}

export function ReplyAssistant({
  opportunityId,
  messageId,
  messageBody,
  jobUrl,
  roomUrl,
}: {
  opportunityId: string;
  messageId: string;
  messageBody: string;
  jobUrl: string;
  roomUrl?: string | null;
}) {
  const [tracks, setTracks] = useState<Tracks>(emptyTracks);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState<ReplyTone | "all" | null>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<ReplyTone | null>(null);
  const storageKey = `bidflo:reply-options:${messageId}`;
  const directRoomHref = (() => {
    if (!roomUrl) return null;
    try {
      const link = new URL(roomUrl);
      if (link.protocol === "https:" && ["upwork.com", "www.upwork.com"].includes(link.hostname)
        && link.pathname.startsWith("/ab/messages/rooms/") && link.pathname.length > "/ab/messages/rooms/".length) {
        return link.href;
      }
    } catch { /* No safe direct room link. */ }
    return null;
  })();

  async function generate(tone?: ReplyTone, current?: Tracks) {
    if (working) return;
    setWorking(tone ?? "all");
    setNotice("");
    try {
      const selected = tone ? (current ?? tracks)[tone] : null;
      const response = await fetch(`/api/opportunities/${opportunityId}/reply-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          ...(tone ? { tone } : {}),
          generation: selected?.versions.length ?? 0,
          previous: selected?.versions.slice(-5).map((v) => v.text) ?? [],
        }),
      });
      const data = await response.json() as { suggestions?: ServiceReply[]; note?: string; error?: string };
      if (!response.ok || !data.suggestions?.length) throw new Error(data.error ?? "Couldn't prepare replies");
      setTracks((old) => {
        const updated = { ...old };
        for (const option of data.suggestions ?? []) {
          if (!REPLY_TONES.includes(option.tone) || !option.text) continue;
          const versions = [...old[option.tone].versions, { text: option.text, source: option.source }];
          updated[option.tone] = { versions, index: versions.length - 1 };
        }
        return updated;
      });
      setNotice(data.note ?? "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't prepare replies");
    } finally {
      setWorking(null);
      setLoaded(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let restored: Tracks | null = null;
    try {
      const existing = localStorage.getItem(storageKey);
      restored = existing ? restoredTracks(JSON.parse(existing)) : null;
    } catch { /* Private browsing or malformed old cache. */ }
    if (restored) {
      const cached = restored;
      // Restore asynchronously after hydration rather than causing a
      // synchronous render cascade inside an effect.
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setTracks(cached);
          setLoaded(true);
        }
      });
    } else {
      // Defer the network request: generate() updates loading state.
      void Promise.resolve().then(() => {
        if (!cancelled) void generate();
      });
    }
    return () => { cancelled = true; };
    // Each message ID has its own version history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(storageKey, JSON.stringify(tracks)); } catch { /* Still usable in private mode. */ }
  }, [tracks, loaded, storageKey]);

  function move(tone: ReplyTone, direction: -1 | 1) {
    setTracks((old) => ({
      ...old,
      [tone]: { ...old[tone], index: Math.min(old[tone].versions.length - 1, Math.max(0, old[tone].index + direction)) },
    }));
    setCopied(null);
  }
  function edit(tone: ReplyTone, text: string) {
    setTracks((old) => {
      const track = old[tone];
      return {
        ...old,
        [tone]: {
          ...track,
          versions: track.versions.map((version, index) => index === track.index ? { ...version, text } : version),
        },
      };
    });
    setCopied(null);
  }
  async function copy(tone: ReplyTone, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tone);
      setNotice("Copied. Open the client's Upwork conversation, paste and send it yourself.");
    } catch {
      setNotice("Clipboard access was blocked. Select the reply text and copy it manually.");
    }
  }

  return (
    <section className="reply-assistant card" aria-labelledby="reply-assistant-title">
      <div className="reply-assistant-top">
        <div>
          <p className="eyebrow">CLIENT REPLIED · NEXT STEP</p>
          <h2 id="reply-assistant-title">Choose your reply.</h2>
          <p>Three tones. One goal: book a conversation through Upwork.</p>
        </div>
        <div className="reply-upwork-links">
          <a className="primary-button" href={directRoomHref ?? INBOX_URL} target="_blank" rel="noopener noreferrer">{directRoomHref ? "Open Client Chat ↗" : "Open Upwork Messages ↗"}</a>
          {/^https:\/\/(www\.)?upwork\.com\//i.test(jobUrl) && <a className="secondary-button" href={jobUrl} target="_blank" rel="noopener noreferrer">View Job ↗</a>}
        </div>
      </div>
      <details className="reply-client-note">
        <summary>Latest client message</summary>
        <p>{messageBody}</p>
      </details>
      <div className="reply-choice-grid">
        {REPLY_TONES.map((tone) => {
          const track = tracks[tone];
          const version = track.versions[track.index];
          return (
            <article className={`reply-choice reply-choice-${tone}`} key={tone}>
              <header className="reply-choice-header">
                <strong>{REPLY_LABELS[tone]}</strong>
                {version && <span>{version.source === "ai" ? "AI drafted" : "Starter draft"}</span>}
              </header>
              {version ? (
                <textarea
                  aria-label={`${REPLY_LABELS[tone]} reply text`}
                  value={version.text}
                  onChange={(event) => edit(tone, event.target.value)}
                  rows={8}
                  spellCheck
                />
              ) : (
                <div className="reply-loading">{working ? "Preparing reply…" : "No draft yet."}</div>
              )}
              <div className="reply-choice-controls">
                <button className="reply-copy" disabled={!version?.text || Boolean(working)} onClick={() => void copy(tone, version!.text)}>
                  {copied === tone ? "Copied ✓" : "Copy reply"}
                </button>
                <button className="reply-regenerate" disabled={Boolean(working)} onClick={() => void generate(tone)}>
                  {working === tone ? "Refreshing…" : "↻ Refresh"}
                </button>
              </div>
              <footer className="reply-history">
                <button onClick={() => move(tone, -1)} disabled={track.index <= 0 || Boolean(working)} aria-label={`Previous ${tone} reply`}>← Previous</button>
                <span>{version ? `${track.index + 1} / ${track.versions.length}` : "0 / 0"}</span>
                <button onClick={() => move(tone, 1)} disabled={track.index >= track.versions.length - 1 || Boolean(working)} aria-label={`Next ${tone} reply`}>Next →</button>
              </footer>
            </article>
          );
        })}
      </div>
      {notice && <p className="reply-notice" role="status">{notice}</p>}
      <p className="reply-assistant-footnote">
        Review wording and availability before sending. Nothing is sent automatically. Before a contract, meetings and messages stay inside Upwork.
      </p>
    </section>
  );
}
