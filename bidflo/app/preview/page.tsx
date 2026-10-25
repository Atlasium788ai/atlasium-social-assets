"use client";
import { useState } from "react";
import "./preview.css";
import { ArrowIcon, BellIcon, DocumentIcon, LogoMark, SearchIcon } from "@/components/bidflo-icons";
type Area = "home" | "find" | "bid" | "follow";
const sections = [
  { id:"find" as const, number:"01",title:"Find",desc:"Scan and surface the best Upwork opportunities.",cta:"View Opportunities", tone:"blue", Icon:SearchIcon },
  { id:"bid" as const, number:"02",title:"Bid",desc:"Create and review tailored proposals in minutes.",cta:"Review Proposals",tone:"violet", Icon:DocumentIcon },
  { id:"follow" as const, number:"03",title:"Follow Up",desc:"Track replies, set reminders and never miss a lead.",cta:"View Follow Ups",tone:"aqua", Icon:BellIcon },
];
const opportunities=[
  {title:"CRM and sales workflow setup",kind:"CRM automation",budget:"$1,000–$3,000"},
  {title:"Lead qualification and appointment booking",kind:"Sales operations",budget:"$1,500–$4,000"},
  {title:"Social content workflow",kind:"Content systems",budget:"$500–$1,500"},
];
export default function VisezPreview() {
  const [area,setArea]=useState<Area>("home");
  const [selected,setSelected]=useState(0);
  const [draft,setDraft]=useState("Hi, we can help organize your CRM and connect lead intake to qualification and booking. We would first confirm your current tools and priorities, then scope a focused implementation. Which CRM are you using today?");
  return <div className="visez-preview-root">
    <header className="visez-preview-header">
      <button className="wordmark visez-preview-brand" onClick={()=>setArea("home")} aria-label="Visez home"><LogoMark/><strong>Visez</strong></button>
      <nav aria-label="Preview sections">{sections.map(x=><button key={x.id} className={area===x.id?"active":""} onClick={()=>setArea(x.id)}>{x.title}</button>)}</nav>
      <span className="visez-preview-mode">VIEW ONLY · SAMPLE CONTENT</span>
    </header>
    {area==="home"? <main className="hub-shell visez-preview-home">
      <div className="hub-grid" aria-hidden="true"/><div className="hub-orbit hub-orbit-one" aria-hidden="true"/><div className="hub-orbit hub-orbit-two" aria-hidden="true"/>
      <section className="hub-hero"><p className="hub-kicker">AI OPPORTUNITY &amp; PROPOSAL AUTOMATION</p><h1>Your Upwork <span>advantage.</span></h1><p className="hub-tagline">AIM. PITCH. WIN.</p><p className="hub-support">Find better opportunities. Build stronger proposals. Win more clients.</p></section>
      <section className="hub-tiles" aria-label="Visez workspaces">{sections.map(x=><button key={x.id} className={`hub-tile tone-${x.tone}`} onClick={()=>setArea(x.id)}><span className="tile-number">{x.number}</span><span className="tile-dots" aria-hidden="true">•••</span><span className="tile-icon"><x.Icon/></span><h2>{x.title}</h2><p>{x.desc}</p><span className="tile-action"><span>{x.cta}</span><ArrowIcon/></span></button>)}</section>
      <footer className="hub-footer">POWERED BY <strong>ATLASIUM <span>7/88</span></strong></footer>
    </main> : <main className={`section-page section-${area==="follow"?"follow":area} visez-preview-workspace`}>
      <header className="section-hero"><div><p className="eyebrow">{area==="find"?"01 · FIND":area==="bid"?"02 · BID":"03 · FOLLOW UP"}</p><h1>{area==="find"?"Find the right opportunities.":area==="bid"?"Bid with precision.":"Never lose momentum."}</h1><p>{area==="find"?"Prioritize relevant freelance work.":area==="bid"?"Review and refine a tailored proposal.":"Track replies, interviews and next actions."}</p></div></header>
      {area==="find"?<div className="visez-preview-list">{opportunities.map((job,i)=><article key={job.title} className="visez-preview-item"><div><span className="visez-preview-subtle">EXAMPLE · {job.kind}</span><h2>{job.title}</h2><p>Sample project for exploring the matching and qualification view.</p></div><div className="visez-preview-end"><strong>{job.budget}</strong><button onClick={()=>{setSelected(i);setArea("bid")}}>Review proposal <ArrowIcon/></button></div></article>)}</div>:
      area==="bid"? <div className="visez-preview-editor"><span className="visez-preview-subtle">SAMPLE · PROPOSAL REVIEW</span><h2>{opportunities[selected].title}</h2><p>{opportunities[selected].budget}</p><label htmlFor="preview-draft">Proposal draft</label><textarea id="preview-draft" rows={8} value={draft} onChange={e=>setDraft(e.target.value)}/><p className="visez-preview-notice">Preview only. No bids or messages will be sent.</p><button onClick={()=>setArea("follow")}>View follow-ups <ArrowIcon/></button></div>:
      <div className="visez-preview-list">{opportunities.slice(0,2).map((job,i)=><article key={job.title} className="visez-preview-item"><div><span className="visez-preview-subtle">SAMPLE · TRACKING</span><h2>{job.title}</h2><p>Reply and follow-up tracking preview.</p></div><div className="visez-preview-end"><strong>{i===0?"Awaiting reply":"Follow-up planned"}</strong><button onClick={()=>setArea("bid")}>Review proposal <ArrowIcon/></button></div></article>)}</div>}
      <footer className="hub-footer">POWERED BY <strong>ATLASIUM <span>7/88</span></strong></footer>
    </main>}
  </div>;
}
