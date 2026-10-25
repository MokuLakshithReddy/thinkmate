-- 001_mvp.sql: ThinkMate v0.1 Core Schema & RLS

create table if not exists public.tm_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled problem',
  mode text not null default 'balanced' check (mode in ('guide', 'balanced', 'ideas')),
  problem_frame text,
  problem_frame_confirmed boolean not null default false,
  proposed_problem_frame text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tm_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  kind text not null check (kind in ('claim', 'question')),
  text text not null check (char_length(text) between 3 and 500),
  origin text not null check (origin in ('user', 'ai')),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tm_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  guidance_mode text,
  created_at timestamptz not null default now()
);

create table if not exists public.tm_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists tm_items_workspace_status_idx on public.tm_items (workspace_id, status);
create index if not exists tm_messages_workspace_seq_idx on public.tm_messages (workspace_id, seq);
create index if not exists tm_events_workspace_created_idx on public.tm_events (workspace_id, created_at);

alter table public.tm_workspaces enable row level security;
alter table public.tm_items enable row level security;
alter table public.tm_messages enable row level security;
alter table public.tm_events enable row level security;

create policy tm_workspaces_owner on public.tm_workspaces for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy tm_items_owner on public.tm_items for all to authenticated
  using (exists (select 1 from public.tm_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.tm_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

create policy tm_messages_owner on public.tm_messages for all to authenticated
  using (exists (select 1 from public.tm_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.tm_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

create policy tm_events_owner on public.tm_events for all to authenticated
  using (exists (select 1 from public.tm_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.tm_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
