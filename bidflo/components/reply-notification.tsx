"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ReplyAssistant } from "@/components/reply-assistant";

type IncomingReply = {
  id: string;
  body: string;
  opportunity_id: string;
  title: string;
  job_url: string;
  upwork_room_url: string | null;
};

export function ReplyNotification() {
  const pathname = usePathname();
  const [active, setActive] = useState<IncomingReply | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // The opportunity detail screen displays the same reply assistant in-page.
    if (pathname.startsWith("/opportunities/")) return;
    let cancelled = false;
    async function check() {
      try {
        const response = await fetch("/api/follow-up/replies", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { replies?: IncomingReply[] };
        if (cancelled || !Array.isArray(data.replies)) return;
        const newest = data.replies.find((item) => {
          if (!item.id || !item.opportunity_id) return false;
          try { return localStorage.getItem(`bidflo:reply-seen:${item.id}`) !== "1"; }
          catch { return true; }
        });
        if (newest) setActive((current) => current?.id === newest.id ? current : newest);
      } catch {
        // A temporary outage should not interrupt Find, Bid or Follow Up.
      }
    }
    void check();
    const polling = setInterval(() => void check(), 45_000);
    return () => { cancelled = true; clearInterval(polling); };
  }, [pathname]);

  function dismiss() {
    if (active) {
      try { localStorage.setItem(`bidflo:reply-seen:${active.id}`, "1"); } catch {}
    }
    setActive(null);
    setHidden(false);
  }

  if (!active || pathname.startsWith("/opportunities/")) return null;
  return (
    <div className="reply-alert-overlay" role="presentation">
      <section className="reply-alert-dialog" role="dialog" aria-modal="true" aria-labelledby="reply-alert-heading">
        <header className="reply-alert-heading">
          <div>
            <p className="eyebrow">NEW UPWORK RESPONSE</p>
            <h2 id="reply-alert-heading">Client replied.</h2>
            <p>{active.title}</p>
          </div>
          <div className="reply-alert-actions">
            <Link href={`/opportunities/${active.opportunity_id}`} onClick={dismiss}>View opportunity ↗</Link>
            <button onClick={dismiss} aria-label="Dismiss client reply prompt">Close ×</button>
          </div>
        </header>
        <ReplyAssistant
          key={active.id}
          opportunityId={active.opportunity_id}
          messageId={active.id}
          messageBody={active.body}
          jobUrl={active.job_url}
          roomUrl={active.upwork_room_url}
        />
      </section>
    </div>
  );
}
