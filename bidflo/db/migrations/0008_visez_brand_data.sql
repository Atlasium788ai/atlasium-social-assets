-- Remove the former display brand from stored operator-facing records while
-- preserving stable table names and foreign keys used by the live system.
update bidflo_opportunities
set
  title = replace(title, 'Bid' || 'Flo', 'Visez'),
  description = replace(description, 'Bid' || 'Flo', 'Visez'),
  client_name = case
    when client_name is null then null
    else replace(client_name, 'Bid' || 'Flo', 'Visez')
  end,
  updated_at = now()
where title like '%' || 'Bid' || 'Flo' || '%'
   or description like '%' || 'Bid' || 'Flo' || '%'
   or client_name like '%' || 'Bid' || 'Flo' || '%';

update bidflo_proposals
set body = replace(body, 'Bid' || 'Flo', 'Visez'), updated_at = now()
where body like '%' || 'Bid' || 'Flo' || '%';
