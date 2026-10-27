"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowIcon, BriefcaseIcon, ChartIcon, DocumentIcon, TrophyIcon, NurtureIcon } from "@/components/visez-icons";
import { prioritizeOpportunities } from "@/lib/opportunity-priority";
import type { OpportunityRow, OpportunityStatus } from "@/lib/types";

type Mode = "find" | "bid" | "approval" | "follow" | "won" | "nurture";

const labels: Record<string, string> = {
  new: "New opportunity", qualified: "Qualified", rejected: "Not a fit", proposal_ready: "Ready to review",
  approved: "Approved", ready_to_submit: "Ready to submit", submission_processing: "Verify in Upwork", submitted: "Submitted", replied: "Client replied",
  interviewed: "Interview", won: "Won", nurture: "Nurture", opted_out: "Do not contact",
  lost: "Lost",
};

const modeStatuses: Record<Mode, OpportunityStatus[]> = {
  find: ["new", "qualified", "rejected", "proposal_ready", "approved", "ready_to_submit", "submission_processing", "submitted", "replied", "interviewed", "nurture", "won"],
  bid: ["qualified", "proposal_ready", "approved", "ready_to_submit", "submission_processing"],
  approval: ["proposal_ready", "approved", "ready_to_submit", "submission_processing"],
  follow: ["submission_processing", "submitted", "replied", "interviewed", "nurture", "won", "lost", "opted_out"],
  won: ["won"],
  nurture: ["nurture"],
};

function budgetLabel(item: OpportunityRow) {
  const minimum = Number(item.budget_min ?? 0);
  const maximum = Number(item.budget_max ?? 0);
  if (!minimum && !maximum) return "Budget open";
  const format = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: item.currency || "USD", maximumFractionDigits: 0 }).format(value);
  const amount = minimum && maximum && minimum !== maximum ? `${format(minimum)}–${format(maximum)}` : format(maximum || minimum);
  return item.budget_type === "hourly" ? `${amount}/hr` : amount;
}

export function OpportunityBoard({ opportunities, mode }: { opportunities: OpportunityRow[]; mode: Mode }) {
  const [filter, setFilter] = useState("all");
  const list = useMemo(() => prioritizeOpportunities(
    opportunities.filter((item) => modeStatuses[mode].includes(item.status) && (filter === "all" || item.status === filter)),
    mode,
  ), [filter, mode, opportunities]);
  const Icon = mode === "find" ? BriefcaseIcon : mode === "bid" || mode === "approval" ? DocumentIcon : mode === "won" ? TrophyIcon : mode === "nurture" ? NurtureIcon : ChartIcon;
  const empty = mode === "find" ? "New notifications will appear here automatically." : mode === "bid" ? "Qualified proposals will appear here for review." : mode === "approval" ? "Proposals that need a decision will appear here." : mode === "won" ? "Your wins will appear here." : mode === "nurture" ? "Relationships moved from follow-up will appear here. Client opt-outs are not contacted." : "Submitted bids and client replies will appear here.";

  return <section className={`opportunity-board board-${mode}`}>
    <div className="board-heading"><div><p className="eyebrow">LIVE WORKSPACE</p><h2>{mode === "find" ? "Opportunity inbox" : mode === "bid" ? "Proposal queue" : mode === "approval" ? "Approval queue" : mode === "won" ? "Won clients" : mode === "nurture" ? "Relationships to nurture" : "Opportunity pipeline"}</h2><p>{list.length} records in this view</p></div><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter opportunities"><option value="all">All stages</option>{modeStatuses[mode].map((status) => <option value={status} key={status}>{labels[status]}</option>)}</select></div>
    <div className="opportunity-cards">
      {list.length === 0 && <div className="empty-state futuristic-empty"><span><Icon /></span><h3>Visez is standing by</h3><p>{empty}</p></div>}
      {list.map((item, index) => <Link href={`/opportunities/${item.id}`} className={`opportunity-card accent-${index % 3}`} key={item.id}>
        <span className="op-card-icon"><Icon /></span>
        <div className="op-card-main">
          <div className="op-card-brand"><span className="mini-mark">V</span><strong>Visez</strong><em>{labels[item.status] ?? item.status}</em></div>
          <h3>{item.title}</h3><p>{item.description.slice(0, 190)}{item.description.length > 190 ? "…" : ""}</p>
          <div className="op-tags"><span>{item.budget_type ?? "project"}</span><span>{item.recurring_potential ? "Recurring potential" : "Project delivery"}</span><span>Profit fit {item.score_breakdown?.profitability ?? "—"}/15</span><span>{item.client_location ?? "Upwork"}</span>{mode === "follow" && item.follow_up_state && <span>{item.follow_up_state.label}</span>}</div>
        </div>
        <div className="op-card-commercial"><small>{item.client_name ?? "Upwork client"}</small><strong>{budgetLabel(item)}</strong><span>Fit score: {item.score ?? "—"}/100</span><i><b style={{ width: `${item.score ?? 0}%` }} /></i><span className="op-open">{mode === "follow" && item.status === "replied" ? "Write client reply" : "View Opportunity"} <ArrowIcon /></span></div>
      </Link>)}
    </div>
  </section>;
}
