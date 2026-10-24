create table if not exists bidflo_notifications (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  opportunity_id uuid references bidflo_opportunities(id) on delete set null,
  message text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bidflo_notifications_status_check check (status in ('pending','sending','sent','failed'))
);

create index if not exists bidflo_notifications_pending_idx
  on bidflo_notifications(status, retry_at, created_at);
