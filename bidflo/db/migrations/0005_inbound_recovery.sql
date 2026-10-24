-- Keep inbound work recoverable after a crash and make client messages idempotent.
alter table bidflo_inbound_events
  add column if not exists attempts integer not null default 0;
alter table bidflo_inbound_events
  add column if not exists retry_at timestamptz not null default now();

alter table bidflo_messages
  add column if not exists source_event_id uuid references bidflo_inbound_events(id) on delete set null;

create unique index if not exists bidflo_messages_source_event_uniq
  on bidflo_messages(source_event_id) where source_event_id is not null;

create index if not exists bidflo_inbound_events_work_idx
  on bidflo_inbound_events(status, retry_at, received_at);
