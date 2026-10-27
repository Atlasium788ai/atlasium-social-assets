import Link from "next/link";
import { ArrowIcon, BellIcon, DocumentIcon, LogoMark, SearchIcon } from "@/components/visez-icons";

type Metrics = {
  approval_queue: number;
  submitted: number;
  total: number;
  won: number;
  nurture: number;
  processor?: {
    last_checked_at: string | null;
    last_event_count: number | null;
    last_data_processed_at: string | null;
    retrying: number;
    failed: number;
  };
};

const sections = [
  { number: "01", href: "/find", title: "Find", copy: "Scan and surface the best Upwork opportunities.", action: "View Opportunities", tone: "blue", icon: SearchIcon },
  { number: "02", href: "/bid", title: "Bid", copy: "Create and review tailored proposals in minutes.", action: "Review Proposals", tone: "violet", icon: DocumentIcon },
  { number: "03", href: "/follow-up", title: "Follow Up", copy: "Track replies, reminders, relationships, and wins.", action: "View Follow Ups", tone: "aqua", icon: BellIcon },
] as const;

function statusTime(value: string | null | undefined) {
  if (!value) return "not yet recorded";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(value));
}

export function HomeHub({ email, metrics, integrations, previewMode = false }: {
  email: string;
  metrics: Metrics;
  integrations: { aiConfigured: boolean; inboxConfigured: boolean };
  previewMode?: boolean;
}) {
  const processor = metrics.processor;
  const processorRecorded = Boolean(processor?.last_checked_at);
  return <main className="hub-shell">
    <div className="hub-grid" aria-hidden="true" />
    <div className="hub-orbit hub-orbit-one" aria-hidden="true" />
    <div className="hub-orbit hub-orbit-two" aria-hidden="true" />
    <header className="hub-topbar">
      <Link href="/" className="wordmark"><LogoMark /><strong>Visez</strong></Link>
      <div className="hub-account"><span className="live-pill"><i />{processorRecorded ? "Active" : "Starting"}<small>{processorRecorded ? "Server processor" : "Awaiting first check"}</small></span>{previewMode && <Link href="/login" className="public-access-chip">View only · Sign in to work</Link>}<span className="avatar">{email.slice(0, 1).toUpperCase()}</span></div>
    </header>
    <section className="hub-hero">
      <p className="hub-kicker">AI OPPORTUNITY &amp; PROPOSAL AUTOMATION</p>
      <h1>Your Upwork <span>advantage.</span></h1>
      <p className="hub-tagline">AIM. PITCH. WIN.</p>
      <p className="hub-support">Find better opportunities. Build stronger proposals. Win more clients.</p>
    </section>
    <section className="hub-tiles" aria-label="Visez workspaces">
      {sections.map(({ number, href, title, copy, action, tone, icon: Icon }) => <Link href={href} className={`hub-tile tone-${tone}`} key={href}>
        <span className="tile-number">{number}</span><span className="tile-dots" aria-hidden="true">•••</span>
        <span className="tile-icon"><Icon /></span>
        <h2>{title}</h2><p>{copy}</p>
        <span className="tile-action"><span>{action}</span><ArrowIcon /></span>
        <span className="tile-stat">{title === "Find" ? `${metrics.total} captured` : title === "Bid" ? `${metrics.approval_queue} awaiting review` : `${metrics.submitted} applications tracked`}</span>
      </Link>)}
    </section>
    <section className="launch-status" aria-label="Visez integration status">
      <span className={integrations.inboxConfigured ? "ok" : "attention"}><i />Upwork inbox {integrations.inboxConfigured ? "configured" : "needs connection"}</span>
      <span className={integrations.aiConfigured ? "ok" : "attention"}><i />Proposal engine {integrations.aiConfigured ? "configured" : "needs connection"}</span>
      <span className={processor?.last_checked_at ? "ok" : "attention"}><i />Processor checked {statusTime(processor?.last_checked_at)}</span>
      <span><i />Last inbound data {statusTime(processor?.last_data_processed_at)}</span>
      <span className={processor?.retrying ? "attention" : "ok"}><i />{processor?.retrying ?? 0} retrying</span>
      <span className={processor?.failed ? "attention" : "ok"}><i />{processor?.failed ?? 0} failed</span>
    </section>
    <footer className="hub-footer">POWERED BY <strong>ATLASIUM <span>7/88</span></strong></footer>
  </main>;
}
