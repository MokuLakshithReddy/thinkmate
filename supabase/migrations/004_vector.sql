-- 004_vector.sql: Vector Retrieval for ThinkMate Items (Optional/Layer 4)

create extension if not exists vector with schema extensions;

alter table public.tm_items add column if not exists embedding extensions.vector(768);

create index if not exists tm_items_embedding_idx on public.tm_items using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.tm_match_items(ws uuid, query extensions.vector(768), lim int default 10)
returns setof public.tm_items language sql stable security invoker set search_path = public, extensions as $$
  select * from public.tm_items
  where workspace_id = ws and status = 'confirmed' and superseded_by is null
  and embedding is not null
  order by embedding <=> query
  limit lim;
$$;
