-- 013_invites.sql
-- Token-based team invitations for workspaces

create table if not exists public.tm_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tm_workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tm_invites enable row level security;

drop policy if exists tm_invites_select on public.tm_invites;
create policy tm_invites_select on public.tm_invites
  for select
  to authenticated
  using (
    invited_by = (select auth.uid())
    or exists (
      select 1 from public.tm_workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
  );

drop policy if exists tm_invites_delete on public.tm_invites;
create policy tm_invites_delete on public.tm_invites
  for delete
  to authenticated
  using (
    invited_by = (select auth.uid())
    or exists (
      select 1 from public.tm_workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
  );

drop policy if exists tm_invites_insert on public.tm_invites;
create policy tm_invites_insert on public.tm_invites
  for insert
  to authenticated
  with check (
    invited_by = (select auth.uid())
    and exists (
      select 1 from public.tm_workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
  );

create or replace function public.tm_accept_invite(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite public.tm_invites%rowtype;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  select * into v_invite
  from public.tm_invites
  where token_hash = p_token_hash
    and accepted_at is null
    and expires_at > now()
  for update;

  if v_invite.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  end if;

  insert into public.tm_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, v_uid, v_invite.role)
  on conflict (workspace_id, user_id) do update
  set role = excluded.role;

  update public.tm_invites
  set accepted_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'ok', true,
    'workspace_id', v_invite.workspace_id,
    'role', v_invite.role
  );
end $$;

revoke all on function public.tm_accept_invite(text) from public, anon;
grant execute on function public.tm_accept_invite(text) to authenticated;
