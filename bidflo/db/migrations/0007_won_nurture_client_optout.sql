-- Keep nurturing separate from an explicit client-requested contact stop.
-- No "Lost" bucket is added. Historical statuses are left untouched.
alter table bidflo_opportunities
  add column if not exists nurture_note text,
  add column if not exists nurture_due_at date,
  add column if not exists opted_out_at timestamptz,
  add column if not exists opt_out_source text;
create index if not exists bidflo_opportunities_nurture_due_idx
  on bidflo_opportunities(nurture_due_at)
  where status = 'nurture';
