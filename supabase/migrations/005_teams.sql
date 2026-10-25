-- 005_teams.sql: Team Workspaces for ThinkMate

create table if not exists public.tm_members (
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.tm_members enable row level security;

create or replace function public.tm_can_access(ws uuid, need_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as
$$
select exists (
  select 1 from public.tm_workspaces w where w.id = ws and w.owner_id = (select auth.uid())
)
or exists (
  select 1 from public.tm_members m where m.workspace_id = ws and m.user_id = (select auth.uid())
  and (not need_write or m.role = 'editor')
);
$$;

drop policy if exists tm_members_read on public.tm_members;
create policy tm_members_read on public.tm_members for select to authenticated
  using (user_id = (select auth.uid())
  or exists (select 1 from public.tm_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

drop policy if exists tm_members_remove on public.tm_members;
create policy tm_members_remove on public.tm_members for delete to authenticated
  using (user_id = (select auth.uid())
  or exists (select 1 from public.tm_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

drop policy if exists tm_workspaces_owner on public.tm_workspaces;
drop policy if exists tm_workspaces_select on public.tm_workspaces;
drop policy if exists tm_workspaces_insert on public.tm_workspaces;
drop policy if exists tm_workspaces_update on public.tm_workspaces;
drop policy if exists tm_workspaces_delete on public.tm_workspaces;

create policy tm_workspaces_select on public.tm_workspaces for select to authenticated
  using (owner_id = (select auth.uid()) or public.tm_can_access(id));

create policy tm_workspaces_insert on public.tm_workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy tm_workspaces_update on public.tm_workspaces for update to authenticated
  using (public.tm_can_access(id, true))
  with check (public.tm_can_access(id, true));

create policy tm_workspaces_delete on public.tm_workspaces for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke update on public.tm_workspaces from authenticated;
grant update (title, mode, stage, problem_frame, problem_frame_confirmed, proposed_problem_frame, updated_at)
on public.tm_workspaces to authenticated;

create or replace function public.tm_invite(ws uuid, invitee_email text, member_role text default 'editor')
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not exists (select 1 from public.tm_workspaces w where w.id = ws and w.owner_id = (select auth.uid())) then
    raise exception 'not_owner';
  end if;
  select id into uid from auth.users where lower(email) = lower(invitee_email);
  if uid is null then
    raise exception 'no_such_user';
  end if;
  insert into public.tm_members (workspace_id, user_id, role)
  values (ws, uid, member_role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;
end $$;

revoke all on function public.tm_invite(uuid, text, text) from public, anon;
grant execute on function public.tm_invite(uuid, text, text) to authenticated;
