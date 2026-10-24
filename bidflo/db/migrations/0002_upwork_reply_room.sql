alter table bidflo_messages
  add column if not exists upwork_room_url text;

create index if not exists bidflo_messages_opportunity_received_idx
  on bidflo_messages(opportunity_id, received_at desc);
