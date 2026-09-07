"use client";

import { useState } from "react";
import type { FlowBrand, FlowPublishJob } from "../services/flow-brand-service";
import type { FlowSection } from "./flow-section-navigation";

function validDate(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function formatDate(value: string, timeZone: string) {
  const date = validDate(value);
  if (!date) return "Managed by Buffer queue";
  return new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTime(value: string, timeZone: string) {
  const date = validDate(value);
  if (!date) return value === "shareNow" ? "Immediate" : "Buffer queue";
  return new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}

function surface(job: FlowPublishJob) {
  const value = job.destinationId.split("#")[1]?.split(":")[1] || "post";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function delivery(job: FlowPublishJob) {
  if (job.deliveryError || job.error || job.status === "failed" || job.providerStatus === "error") return { label: "Failed", tone: "failed" };
  if (job.status === "sent" || job.providerStatus === "sent") return { label: "Sent", tone: "sent" };
  if (job.providerStatus) return { label: job.providerStatus.replaceAll("_", " "), tone: "pending" };
  return { label: job.status === "confirmed" ? "Buffer confirmed" : job.status.replaceAll("_", " "), tone: "pending" };
}

function FlowJobRow({ job, brand }: { job: FlowPublishJob; brand: FlowBrand }) {
  const state = delivery(job);
  return <article className="flow-job-row">
    <div className="flow-job-date"><b>{formatDate(job.scheduledTime, brand.timezone)}</b><span>{formatTime(job.scheduledTime, brand.timezone)}</span></div>
    <div className="flow-job-copy"><span>{job.service.toUpperCase()} · {surface(job)}</span><h3>{job.concept}</h3><small>{job.accountName}</small></div>
    <div className={`flow-delivery-status ${state.tone}`}><i />{state.label}</div>
    {job.publicUrl && <a href={job.publicUrl} target="_blank" rel="noreferrer">View post</a>}
    {(job.deliveryError || job.error) && <p className="flow-job-error">{job.deliveryError || job.error}</p>}
  </article>;
}

export function FlowOperations({ section, brand, jobs, refreshing, onRefresh }: { section: Exclude<FlowSection, "channels">; brand: FlowBrand; jobs: FlowPublishJob[]; refreshing: boolean; onRefresh(): void }) {
  const [now] = useState(() => Date.now());
  const scheduled = jobs.filter((job) => validDate(job.scheduledTime)).sort((a, b) => Date.parse(a.scheduledTime) - Date.parse(b.scheduledTime));
  const upcoming = scheduled.filter((job) => Date.parse(job.scheduledTime) > now && delivery(job).tone !== "failed" && delivery(job).tone !== "sent");
  const activity = [...jobs].sort((a, b) => Date.parse(b.checkedAt || b.updatedAt || b.createdAt) - Date.parse(a.checkedAt || a.updatedAt || a.createdAt));
  const displayed = section === "calendar" ? scheduled : section === "queue" ? upcoming : activity;
  const copy = {
    calendar: { eyebrow: "PUBLISHING CALENDAR", title: "Scheduled content", description: "A read-only view of every dated Buffer submission for this brand." },
    queue: { eyebrow: "UPCOMING QUEUE", title: "What is scheduled next", description: "Future posts accepted by Buffer. Edit or cancel them in Buffer." },
    activity: { eyebrow: "DELIVERY ACTIVITY", title: "Buffer delivery status", description: "EchoFlow checks due posts against Buffer and records the latest delivery result." },
  }[section];

  return <section className="flow-operations">
    <header className="flow-section-heading">
      <div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.description}</p></div>
      <button type="button" className="flow-refresh" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Checking…" : "Refresh status"}</button>
    </header>
    <div className="flow-metrics">
      <article><span>CONNECTED</span><b>{jobs.filter((job) => job.status === "confirmed").length}</b><small>Accepted by Buffer</small></article>
      <article><span>UPCOMING</span><b>{upcoming.length}</b><small>Future scheduled items</small></article>
      <article><span>SENT</span><b>{jobs.filter((job) => delivery(job).tone === "sent").length}</b><small>Verified deliveries</small></article>
      <article><span>NEEDS ATTENTION</span><b>{jobs.filter((job) => delivery(job).tone === "failed").length}</b><small>Failed or rejected</small></article>
    </div>
    <div className="flow-job-list">
      {displayed.length ? displayed.map((job) => <FlowJobRow key={job.id} job={job} brand={brand} />) : <div className="flow-empty">
        <span>0</span><h2>{section === "queue" ? "Nothing is scheduled next." : "No publishing records yet."}</h2>
        <p>Create and schedule social content in ECHO, then return here to monitor it.</p>
        <a href="/echo">Go to ECHO</a>
      </div>}
    </div>
    <p className="flow-readonly-note">FLOW is read-only in this release. It never edits or cancels Buffer posts.</p>
  </section>;
}
