-- Extend Atlasium's configured opportunity signals without overwriting owner customizations.
update bidflo_settings
set qualification_rules = jsonb_set(
      qualification_rules,
      '{serviceFitKeywords}',
      (
        select jsonb_agg(value order by value)
        from (
          select distinct value
          from jsonb_array_elements_text(coalesce(qualification_rules -> 'serviceFitKeywords', '[]'::jsonb)) as current(value)
          union
          select value from (values
            ('genesys cloud cx'), ('genesys architect'), ('ivr'), ('acd'), ('contact centre'), ('contact center'), ('routing'),
            ('meta ads'), ('facebook ads'), ('instagram ads'), ('google ads'), ('tiktok ads'), ('ppc'), ('seo'), ('sem'),
            ('hubspot'), ('salesforce'), ('zoho'), ('pipedrive'), ('landing page'), ('sales funnel'), ('conversion tracking')
          ) as additions(value)
        ) as merged
      ),
      true
    ),
    capability_profile = jsonb_set(
      capability_profile,
      '{services}',
      (
        select jsonb_agg(value order by value)
        from (
          select distinct value
          from jsonb_array_elements_text(coalesce(capability_profile -> 'services', '[]'::jsonb)) as current(value)
          union
          select value from (values
            ('Genesys Cloud CX discovery, Architect, IVR, ACD, routing, migrations, and integrations subject to specialist scope confirmation'),
            ('Meta, Facebook, Instagram, Google, and TikTok advertising and PPC'),
            ('SEO, SEM, landing pages, funnels, conversion tracking, and campaign optimization'),
            ('HubSpot, Salesforce, Zoho, and Pipedrive implementation, integration, migration, and optimization')
          ) as additions(value)
        ) as merged
      ),
      true
    ),
    proposal_rules = proposal_rules || jsonb_build_object(
      'specialistAvailabilityPolicy',
      'Never claim specialist availability, vendor certification, or delivery capacity until scope, availability, and fulfilment economics are confirmed for that opportunity.'
    ),
    updated_at = now()
where id = 'default';
