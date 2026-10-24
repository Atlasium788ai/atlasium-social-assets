"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowIcon, BriefcaseIcon, ChartIcon, DocumentIcon } from "@/components/bidflo-icons";
import type { OpportunityRow, OpportunityStatus } from "@/lib/types";

type Mode = "find" | "bid" | "follow";

const labels: Record<string, string> = {
  new: "New opportunity", qualified: "Qualified", rejected: "Not a fit", proposal_ready: "Ready to review",
  approved: "Approved", ready_to_submit: "Ready to submit", submitted: "Submitted", replied: "Client replied",
  interviewed: "Interview", won: "Won", lost: "Lost",
};

const modeStatuses: Record<Mode, OpportunityStatus[]> = {
  find: ["new", "qualified", "rejected", "proposal_ready", "approved", "ready_to_submit", "submitted", "replied", "interviewed", "won", "lost"],
  bid: ["qualified", "proposal_ready", "approved", "ready_to_submit"],
  follow: ["submitted", "replied", "interviewed", "won", "lost"],
};

function money(value: string | number | null | undefined) {
  return value ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value)) : "Budget open";
}

export function OpportunityBoard({ opportunities, mode }: { opportunities: OpportunityRow[]; mode: Mode }) {
  const [filter, setFilter] = useState("all");
  const list = useMemo(() => opportunities.filter((item) => modeStatuses[mode].includes(item.status) && (filter === "all" || item.status === filter)), [filter, mode, opportunities]);
  const Icon = mode === "find" ? BriefcaseIcon : mode === "bid" ? DocumentIcon : ChartIcon;
  const empty = mode === "find" ? "New notifications will appear here automatically." : mode === "bid" ? "Qualified proposals will appear here for review." : "Submitted bids and client replies will appear here.";

  return <section className={`opportunity-board board-${mode}`}>
    <div className="board-heading"><div><p className="eyebrow">LIVE WORKSPACE</p><h2>{mode === "find" ? "Opportunity inbox" : mode === "bid" ? "Proposal queue" : "Opportunity pipeline"}</h2><p>{list.length} records in this view</p></div><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter opportunities"><option value="all">All stages</option>{modeStatuses[mode].map((status) => <option value={status} key={status}>{labels[status]}</option>)}</select></div>
    <div className="opportunity-cards">
      {list.length === 0 && <div className="empty-state futuristic-empty"><span><Icon /></span><h3>BidFlo is standing by</h3><p>{empty}</p></div>}
      {list.map((item, index) => <Link href={`/opportunities/${item.id}`} className={`opportunity-card accent-${index % 3}`} key={item.id}>
        <span className="op-card-icon"><Icon /></span>
        <div className="op-card-main">
          <div className="op-card-brand"><span className="mini-mark">B</span><strong>Bid<span>Flo</span></strong><em>{labels[item.status] ?? item.status}</em></div>
          <h3>{item.title}</h3><p>{item.description.slice(0, 190)}{item.description.length > 190 ? "…" : ""}</p>
          <div className="op-tags"><span>{item.budget_type ?? "project"}</span><span>{item.recurring_potential ? "Recurring potential" : "Project delivery"}</span><span>{item.client_location ?? "Upwork"}</span></div>
        </div>
        <div className="op-card-commercial"><small>{item.client_name ?? "Upwork client"}</small><strong>{money(item.budget_max)}</strong><span>Fit score: {item.score ?? "—"}/100</span><i><b style={{ width: `${item.score ?? 0}%` }} /></i><span className="op-open">View Opportunity <ArrowIcon /></span></div>
      </Link>)}
    </div>
  </section>;
}
