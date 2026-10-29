alter table bidflo_proposals
  add column if not exists attachment_recommendations jsonb not null default '[]'::jsonb;

create table if not exists bidflo_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references bidflo_messages(id) on delete cascade,
  tone text not null check (tone in ('direct', 'consultative', 'friendly')),
  version integer not null default 1,
  body text not null,
  source text not null check (source in ('ai', 'starter')),
  created_at timestamptz not null default now(),
  unique(message_id, tone, version)
);

create index if not exists bidflo_reply_drafts_message_idx
  on bidflo_reply_drafts(message_id, tone, version desc);

update bidflo_settings
set
  capability_profile = jsonb_set(
    capability_profile,
    '{proof}',
    coalesce(capability_profile -> 'proof', '[]'::jsonb) || jsonb_build_array(
      'Atlasium has confirmed white-label permission to use its paid-media fulfilment partner''s anonymized case studies and collateral.',
      'Atlasium''s paid-media fulfilment partner reports more than 10,000 campaigns since 2009. This must always be attributed to the fulfilment partner, not presented as Atlasium''s own campaign history.'
    ),
    true
  ),
  proposal_rules = proposal_rules || jsonb_build_object(
    'prepareAllQualified', true,
    'fulfilmentNotes', jsonb_build_array(
      'Paid-media fulfilment is available through an approved white-label partner, subject to scope and capacity confirmation.',
      'Current wholesale starting points: Google/Meta/TikTok Ads USD 299 monthly; SEO USD 299 monthly; social posting USD 149 monthly; content writing USD 89; backlinks USD 199; Google Business Profile ranking USD 149 monthly plus a possible USD 99 setup; business listings USD 39; website hosting USD 25. Ad spend and any platform setup fees are separate.',
      'Protect Atlasium margin and never expose wholesale pricing in a client proposal.'
    ),
    'approvedAttachments', jsonb_build_array(
      jsonb_build_object(
        'id', 'atlasium-paid-media-fulfilment-overview',
        'name', 'Atlasium Paid Media Fulfilment Overview.pdf',
        'href', '/api/attachments/atlasium-paid-media-fulfilment-overview',
        'description', 'Atlasium-branded delivery overview with verified, partner-attributed paid-media capabilities.',
        'keywords', jsonb_build_array('google ads', 'meta ads', 'facebook ads', 'instagram ads', 'tiktok ads', 'ppc', 'paid media', 'advertising', 'lead generation'),
        'verified', true
      )
    )
  ),
  updated_at = now()
where id = 'default';
