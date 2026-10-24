update bidflo_opportunities
set client_name = null,
    updated_at = now()
where client_name ~* '^location\s*:';
