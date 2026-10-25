-- Defense in depth for duplicate job variants and repeated submission actions.
create unique index if not exists bidflo_opportunities_external_key_casefold_idx
  on bidflo_opportunities (lower(external_key));

create unique index if not exists bidflo_submission_one_success_per_opportunity_idx
  on bidflo_submission_events (opportunity_id)
  where status = 'submitted';

create unique index if not exists bidflo_submission_one_manual_handoff_per_proposal_idx
  on bidflo_submission_events (opportunity_id, proposal_id)
  where status = 'manual_required';
