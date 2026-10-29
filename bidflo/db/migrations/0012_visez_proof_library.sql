create table if not exists visez_proof_documents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 180),
  content bytea not null,
  mime_type text not null default 'application/pdf',
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  description text not null default '',
  keywords text[] not null default '{}',
  verified boolean not null default true,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visez_proof_documents_active_idx
  on visez_proof_documents (active, verified, created_at desc);
