-- Expand the configured service signals without replacing operator-customized rules.
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
            ('reeviq'), ('linklatch'), ('xipherx'), ('elev8'),
            ('advertising'), ('marketing'), ('lead generation'), ('sales outreach'),
            ('appointment booking'), ('revenue consulting'), ('revenue operations'),
            ('crm migration'), ('crm implementation'), ('marketing automation')
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
            ('ReeVIQ CRM implementation and revenue operations'),
            ('LinkLatch booking and conversion workflows'),
            ('XipherX security and automation solutions'),
            ('Elev8 advertising and marketing'),
            ('lead generation, outreach, and appointment booking'),
            ('CRM migration and systems integration'),
            ('revenue consulting and recurring optimization')
          ) as additions(value)
        ) as merged
      ),
      true
    ),
    proposal_rules = proposal_rules || jsonb_build_object(
      'platformSwitchPolicy',
      'Recommend migration or a different platform only when the client states a relevant need; never assume willingness to switch.'
    ),
    updated_at = now()
where id = 'default';
