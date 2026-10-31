-- 015_atomic_limits.sql
-- Atomic, concurrency-safe plan limit enforcement for workspaces and research queries

-- Atomic workspace creation with plan-aware limit check under transaction lock
create or replace function public.tm_create_workspace(p_title text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_limit int;
  v_count int;
  v_id uuid;
  v_clean_title text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  -- User-level transaction lock to eliminate check-then-insert race conditions
  perform pg_advisory_xact_lock(hashtext('tm_ws_' || v_uid::text));

  select pl.workspaces_max into v_limit
  from public.plan_limits pl
  where pl.plan = public.tm_plan_for(v_uid);

  v_limit := coalesce(v_limit, 3);

  select count(*) into v_count
  from public.tm_workspaces
  where owner_id = v_uid;

  if v_count >= v_limit then
    return jsonb_build_object(
      'ok', false,
      'error', 'plan_limit',
      'used', v_count,
      'limit', v_limit
    );
  end if;

  v_clean_title := substring(coalesce(nullif(trim(p_title), ''), 'Untitled problem') from 1 for 120);

  insert into public.tm_workspaces (owner_id, title)
  values (v_uid, v_clean_title)
  returning id into v_id;

  insert into public.tm_events (workspace_id, event_type, payload)
  values (v_id, 'workspace_created', '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'title', v_clean_title,
    'used', v_count + 1,
    'limit', v_limit
  );
end $$;

revoke all on function public.tm_create_workspace(text) from public, anon;
grant execute on function public.tm_create_workspace(text) to authenticated;

-- Atomic research quota reservation based on workspace owner plan
create or replace function public.tm_reserve_research_quota(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
  v_limit int;
  v_used int;
begin
  select owner_id into v_owner
  from public.tm_workspaces
  where id = p_workspace_id;

  if v_owner is null then
    raise exception 'workspace_not_found';
  end if;

  -- Owner-level transaction lock prevents concurrent research turns from bypassing daily cap
  perform pg_advisory_xact_lock(hashtext('tm_res_' || v_owner::text));

  select pl.research_per_day into v_limit
  from public.plan_limits pl
  where pl.plan = public.tm_plan_for(v_owner);

  v_limit := coalesce(v_limit, 3);

  select count(*) into v_used
  from public.tm_events e
  where e.event_type = 'research'
    and e.created_at > now() - interval '1 day'
    and e.workspace_id in (select id from public.tm_workspaces where owner_id = v_owner);

  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit);
  end if;

  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit);
end $$;

revoke all on function public.tm_reserve_research_quota(uuid) from public, anon;
grant execute on function public.tm_reserve_research_quota(uuid) to authenticated;
