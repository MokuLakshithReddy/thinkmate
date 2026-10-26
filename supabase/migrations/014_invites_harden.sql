-- 014_invites_harden.sql
-- Harden team invitations: drop direct client INSERT policy, enforce team plan in RPC,
-- tie invitation acceptance strictly to invited email, and limit pending invites.

drop policy if exists tm_invites_insert on public.tm_invites;
revoke insert on public.tm_invites from authenticated;

create or replace function public.tm_create_invite(
  p_workspace_id uuid,
  p_email text,
  p_role text,
  p_token_hash text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.tm_workspaces w
    where w.id = p_workspace_id and w.owner_id = (select auth.uid())
  ) then
    raise exception 'not_owner';
  end if;

  if public.tm_plan_for((select auth.uid())) <> 'team' then
    raise exception 'plan_required';
  end if;

  if (
    select count(*) from public.tm_invites i
    where i.workspace_id = p_workspace_id
      and i.accepted_at is null
      and i.expires_at > now()
  ) >= 20 then
    raise exception 'too_many_pending';
  end if;

  insert into public.tm_invites (workspace_id, email, role, token_hash, invited_by)
  values (p_workspace_id, lower(p_email), p_role, p_token_hash, (select auth.uid()))
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.tm_create_invite(uuid, text, text, text) from public, anon;
grant execute on function public.tm_create_invite(uuid, text, text, text) to authenticated;

create or replace function public.tm_accept_invite(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite public.tm_invites%rowtype;
  v_uid uuid;
  v_caller_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  select email into v_caller_email
  from auth.users
  where id = v_uid;

  select * into v_invite
  from public.tm_invites
  where token_hash = p_token_hash
    and accepted_at is null
    and expires_at > now()
  for update;

  if v_invite.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  end if;

  if lower(coalesce(v_caller_email, '')) <> lower(v_invite.email) then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
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
