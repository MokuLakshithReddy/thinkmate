-- 003_fts.sql: Full Text Search for ThinkMate Items

alter table public.tm_items add column if not exists tsv tsvector generated always as (to_tsvector('english', text)) stored;

create index if not exists tm_items_tsv_idx on public.tm_items using gin (tsv);

create or replace function public.tm_search_items(ws uuid, q text, lim int default 10)
returns setof public.tm_items language sql stable security invoker as $$
  select * from public.tm_items
  where workspace_id = ws and status = 'confirmed' and superseded_by is null
  and tsv @@ websearch_to_tsquery('english', q)
  order by ts_rank(tsv, websearch_to_tsquery('english', q)) desc
  limit lim;
$$;
