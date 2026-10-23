"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { OpportunityRow } from "@/lib/types";

type Metrics = {
  total: number;
  approval_queue: number;
  submitted: number;
  won: number;
  pipeline: string;
  average_score: string;
  stages: Array<{ status: string; count: number }>;
};

const labels: Record<string, string> = {
  new: "New", qualified: "Qualified", rejected: "Rejected", proposal_ready: "Review ready",
  approved: "Approved", ready_to_submit: "Ready to submit", submitted: "Submitted",
  replied: "Client replied", interviewed: "Interview", won: "Won", lost: "Lost",
};

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function Score({ value }: { value: number | null }) {
  const score = value ?? 0;
  return <div className={`score ${score >= 80 ? "high" : score >= 60 ? "mid" : "low"}`}><strong>{score || "—"}</strong><span>/100</span></div>;
}

export function Dashboard({ opportunities, metrics, view }: { opportunities: OpportunityRow[]; metrics: Metrics; view?: string }) {
  const [filter, setFilter] = useState(view ?? "all");
  const filtered = useMemo(() => opportunities.filter((item) => {
    if (filter === "all" || filter === "inbox") return true;
    if (filter === "approval") return ["proposal_ready", "approved", "ready_to_submit"].includes(item.status);
    if (filter === "replies") return ["replied", "interviewed"].includes(item.status);
    return item.status === filter;
  }), [filter, opportunities]);
  const maxStage = Math.max(1, ...metrics.stages.map((stage) => stage.count));

  return (
    <main>
      <header className="page-header">
        <div><p className="eyebrow">INTELLIGENT OPPORTUNITY MANAGEMENT</p><h1>Good morning, Blair.</h1><p>Here’s what BidFlo is prioritizing for Atlasium today.</p></div>
        <div className="header-actions"><span className="sync-chip"><i /> Inbox connected</span><button className="icon-button" aria-label="Notifications">♢</button></div>
      </header>

      <section className="metrics-grid" aria-label="Pipeline summary">
        <article><span className="metric-icon purple">↗</span><div><small>Active pipeline</small><strong>{money(metrics.pipeline)}</strong><em>approved + submitted</em></div></article>
        <article><span className="metric-icon gold">✓</span><div><small>Awaiting approval</small><strong>{metrics.approval_queue}</strong><em>human decisions</em></div></article>
        <article><span className="metric-icon blue">⌁</span><div><small>Average fit score</small><strong>{Number(metrics.average_score).toFixed(0)}<b>/100</b></strong><em>all qualified signals</em></div></article>
        <article><span className="metric-icon green">$</span><div><small>Wins tracked</small><strong>{metrics.won}</strong><em>{metrics.submitted} submitted</em></div></article>
      </section>

      <section className="workspace-grid">
        <div className="opportunity-panel">
          <div className="section-heading">
            <div><h2>Opportunity command centre</h2><p>{filtered.length} opportunities in view</p></div>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter opportunities">
              <option value="all">All opportunities</option><option value="approval">Approval queue</option><option value="replies">Client replies</option>
              <option value="qualified">Qualified</option><option value="submitted">Submitted</option><option value="won">Won</option><option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="opportunity-list">
            {filtered.length === 0 && <div className="empty-state"><span>⌁</span><h3>No opportunities here yet</h3><p>Forward an Upwork notification to the connected BidFlo inbox. The next processing cycle will score it automatically.</p></div>}
            {filtered.map((item) => (
              <Link href={`/opportunities/${item.id}`} className="opportunity-row" key={item.id}>
                <Score value={item.score} />
                <div className="opportunity-main">
                  <div className="row-title"><h3>{item.title}</h3><span className={`status status-${item.status}`}>{labels[item.status] ?? item.status}</span></div>
                  <p>{item.description.slice(0, 165)}{item.description.length > 165 ? "…" : ""}</p>
                  <div className="row-meta"><span>{item.client_name ?? "Upwork client"}</span><span>{item.budget_max ? money(item.budget_max) : "Budget unstated"}</span><span>{item.budget_type ?? "unknown"}</span></div>
                </div>
                <div className="row-commercial"><small>Suggested bid</small><strong>{item.suggested_bid ? money(item.suggested_bid) : "—"}</strong><span>{item.suggested_timeline ?? "Pending"}</span></div>
                <span className="row-arrow">→</span>
              </Link>
            ))}
          </div>
        </div>

        <aside className="insights-panel">
          <div className="section-heading"><div><h2>Pipeline health</h2><p>Live stage distribution</p></div></div>
          <div className="stage-chart">
            {metrics.stages.slice(0, 7).map((stage) => <div key={stage.status}><span>{labels[stage.status] ?? stage.status}</span><i><b style={{ width: `${Math.max(8, (stage.count / maxStage) * 100)}%` }} /></i><strong>{stage.count}</strong></div>)}
            {metrics.stages.length === 0 && <p className="muted">Stage data appears after the first notification.</p>}
          </div>
          <div className="quality-card">
            <span className="quality-orbit">✦</span><p className="eyebrow">QUALITY CONTROL</p><h3>Two-pass proposal review</h3><p>Every prepared proposal is checked for factual accuracy, fit, profitability, and delivery risk before it reaches your queue.</p>
          </div>
          <div className="guardrail-card"><span>◈</span><div><strong>Approval guardrail active</strong><p>BidFlo cannot submit without your approval.</p></div></div>
        </aside>
      </section>
    </main>
  );
}
