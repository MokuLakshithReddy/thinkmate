-- 002_full_domain.sql: ThinkMate Full Domain Model

create or replace function public.tm_can_access(ws uuid, need_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as
$$
select exists (
  select 1 from public.tm_workspaces w
  where w.id = ws and w.owner_id = (select auth.uid())
);
$$;

revoke all on function public.tm_can_access(uuid, boolean) from public, anon;
grant execute on function public.tm_can_access(uuid, boolean) to authenticated;

alter table public.tm_workspaces
add column if not exists stage text not null default 'orient'
check (stage in ('orient','frame','investigate','diverge','converge','challenge','validate','communicate'));

-- Expand item kinds to six
alter table public.tm_items drop constraint if exists tm_items_kind_check;
alter table public.tm_items add constraint tm_items_kind_check
check (kind in ('claim','question','hypothesis','idea','counterargument','experiment'));

alter table public.tm_items
add column if not exists verification text not null default 'unassessed'
check (verification in ('unassessed','supported','contradicted','mixed')),
add column if not exists superseded_by uuid references public.tm_items(id),
add column if not exists created_by uuid default auth.uid(),
add column if not exists meta jsonb not null default '{}';

alter table public.tm_messages add column if not exists policy_action text;

create table if not exists public.tm_frames (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  version int not null,
  statement text not null,
  stakeholders text[] not null default '{}',
  scope text,
  supersedes_id uuid references public.tm_frames(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, version)
);

create table if not exists public.tm_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  kind text not null check (kind in ('observation','interview','document','dataset','experiment','web_source')),
  title text not null check (char_length(title) between 3 and 200),
  source_ref text,
  summary text not null check (char_length(summary) between 3 and 4000),
  limitations text[] not null default '{}',
  added_by text not null default 'user' check (added_by in ('user','research')),
  meta jsonb not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.tm_item_evidence (
  item_id uuid not null references public.tm_items(id) on delete cascade,
  evidence_id uuid not null references public.tm_evidence(id) on delete cascade,
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  relation text not null check (relation in ('supports','contradicts','context')),
  primary key (item_id, evidence_id)
);

create table if not exists public.tm_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  selected_item_id uuid not null references public.tm_items(id),
  rationale text not null,
  rejected_item_ids uuid[] not null default '{}',
  reconsider_if text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Upgrade RLS policies to tm_can_access
drop policy if exists tm_items_owner on public.tm_items;
drop policy if exists tm_messages_owner on public.tm_messages;
drop policy if exists tm_events_owner on public.tm_events;

do $$ declare t text; begin
foreach t in array array['tm_items','tm_messages','tm_frames','tm_evidence','tm_item_evidence','tm_decisions'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', t || '_access', t);
  execute format($p$create policy %I on public.%I for all to authenticated
    using (public.tm_can_access(workspace_id))
    with check (public.tm_can_access(workspace_id, true))$p$, t || '_access', t);
end loop;
end $$;

-- Events are append-only: read and insert, never update or delete
alter table public.tm_events enable row level security;
drop policy if exists tm_events_read on public.tm_events;
drop policy if exists tm_events_insert on public.tm_events;

create policy tm_events_read on public.tm_events for select to authenticated
  using (public.tm_can_access(workspace_id));

create policy tm_events_insert on public.tm_events for insert to authenticated
  with check (public.tm_can_access(workspace_id, true));
