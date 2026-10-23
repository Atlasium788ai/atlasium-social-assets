create extension if not exists pgcrypto;

create table if not exists bidflo_settings (
  id text primary key default 'default',
  qualification_rules jsonb not null,
  capability_profile jsonb not null,
  proposal_rules jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists bidflo_inbound_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  message_id text,
  sender text not null,
  subject text not null,
  received_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, provider_event_id)
);

create table if not exists bidflo_opportunities (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  platform text not null default 'upwork',
  title text not null,
  description text not null,
  client_name text,
  client_location text,
  client_spend numeric(12,2),
  client_rating numeric(4,2),
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  budget_type text,
  currency text not null default 'USD',
  job_url text not null,
  requirements jsonb not null default '[]'::jsonb,
  source_subject text not null,
  source_received_at timestamptz not null,
  status text not null default 'new',
  score integer,
  score_breakdown jsonb,
  rejection_reason text,
  recurring_potential boolean not null default false,
  suggested_bid numeric(12,2),
  suggested_timeline text,
  suggested_milestones jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bidflo_opportunities_status_score_idx
  on bidflo_opportunities(status, score desc, created_at desc);

create table if not exists bidflo_proposals (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references bidflo_opportunities(id) on delete cascade,
  version integer not null default 1,
  body text not null,
  questions jsonb not null default '[]'::jsonb,
  bid_amount numeric(12,2) not null,
  timeline text not null,
  milestones jsonb not null default '[]'::jsonb,
  quality_score integer,
  quality_review jsonb,
  human_judgment_required boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(opportunity_id, version)
);

create index if not exists bidflo_proposals_opportunity_idx
  on bidflo_proposals(opportunity_id, version desc);

create table if not exists bidflo_messages (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references bidflo_opportunities(id) on delete cascade,
  direction text not null,
  kind text not null,
  sender text,
  subject text,
  body text not null,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists bidflo_submission_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references bidflo_opportunities(id) on delete cascade,
  proposal_id uuid references bidflo_proposals(id) on delete set null,
  status text not null,
  external_submission_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists bidflo_audit_logs (
  id bigserial primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into bidflo_settings (id, qualification_rules, capability_profile, proposal_rules)
values (
  'default',
  '{"minimumScore":55,"autoPrepareScore":70,"minimumBudget":750,"targetHourlyRate":125,"serviceFitKeywords":["automation","ai agent","workflow","next.js","react","node","postgres","crm","integration","dashboard","saas"],"poorFitKeywords":["data entry","captcha","essay","homework","crypto trading bot","unpaid test"],"complexityPenaltyKeywords":["24/7 support","unlimited revisions","same day","urgent today"],"recurringKeywords":["ongoing","monthly","maintenance","retainer","long-term","phase 2"]}',
  '{"company":"Atlasium 7/88","positioning":"Intelligent systems, automation, product engineering, and revenue operations","services":["AI workflow automation","full-stack web applications","systems integration","data and CRM operations","product design and delivery"],"deliveryStandards":["truthful scope and experience","measurable milestones","secure implementation","clear acceptance criteria","no unrealistic promises"]}',
  '{"maxWords":350,"minimumQualityScore":80,"tone":"direct, specific, commercially aware","bannedPhrases":["I hope this message finds you well","game-changer","revolutionize","leverage synergies","As an AI"],"requiredSections":["understanding","approach","timeline","questions"]}'
)
on conflict (id) do nothing;
