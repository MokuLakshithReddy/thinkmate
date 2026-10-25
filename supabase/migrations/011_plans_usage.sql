-- 011_plans_usage.sql
-- Plans, entitlements, metered usage and plan-aware quota reservation

create table if not exists public.plan_limits (
  plan text primary key,
  turns_per_day int not null,
  research_per_day int not null,
  workspaces_max int not null
);

insert into public.plan_limits (plan, turns_per_day, research_per_day, workspaces_max)
values
  ('free', 30, 3, 3),
  ('pro', 300, 30, 100),
  ('team', 1000, 100, 500)
on conflict (plan) do update set
  turns_per_day = excluded.turns_per_day,
  research_per_day = excluded.research_per_day,
  workspaces_max = excluded.workspaces_max;

alter table public.plan_limits enable row level security;

drop policy if exists plan_limits_read on public.plan_limits;
create policy plan_limits_read on public.plan_limits
  for select
  to authenticated
  using (true);

create table if not exists public.billing_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'razorpay',
  provider_subscription_id text unique,
  plan text not null default 'free' references public.plan_limits(plan),
  status text not null default 'created',
  current_period_end timestamptz,
  last_event_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.billing_subscriptions enable row level security;

drop policy if exists billing_subscriptions_read on public.billing_subscriptions;
create policy billing_subscriptions_read on public.billing_subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.billing_events (
  id text primary key,
  provider text not null default 'razorpay',
  event_type text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public.billing_events enable row level security;
-- No client policies: service role only

-- Which plan is a user entitled to right now (internal, not callable by clients)
create or replace function public.tm_plan_for(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select s.plan from public.billing_subscriptions s
    where s.user_id = p_user
      and (
        s.status in ('active', 'authenticated')
        or (s.status = 'cancelled' and s.current_period_end > now())
      )
  ), 'free');
$$;

revoke all on function public.tm_plan_for(uuid) from public, anon, authenticated;

-- What the signed-in user sees: plan, usage today and limits
create or replace function public.tm_my_usage()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select (select auth.uid()) as uid),
  plan as (select public.tm_plan_for(me.uid) as name from me),
  lim as (select pl.* from public.plan_limits pl join plan on pl.plan = plan.name),
  ws as (select w.id from public.tm_workspaces w join me on w.owner_id = me.uid),
  ev as (
    select e.event_type from public.tm_events e
    where e.created_at > now() - interval '1 day'
      and e.workspace_id in (select id from ws)
  )
  select jsonb_build_object(
    'plan', (select name from plan),
    'turns_used', (select count(*) from ev where event_type = 'turn'),
    'turns_limit', (select turns_per_day from lim),
    'research_used', (select count(*) from ev where event_type = 'research'),
    'research_limit', (select research_per_day from lim),
    'workspaces_used', (select count(*) from ws),
    'workspaces_limit', (select workspaces_max from lim)
  );
$$;

revoke all on function public.tm_my_usage() from public, anon;
grant execute on function public.tm_my_usage() to authenticated;

-- Plan-aware quota reservation: the limit comes from the workspace owner's plan, never from the caller
create or replace function public.tm_reserve_turn_quota_for_plan(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
  v_limit int;
begin
  select owner_id into v_owner from public.tm_workspaces where id = p_workspace_id;
  if v_owner is null then
    raise exception 'Workspace not found';
  end if;

  select pl.turns_per_day into v_limit
  from public.plan_limits pl
  where pl.plan = public.tm_plan_for(v_owner);

  if v_limit is null then
    v_limit := 30; -- Safe default to free tier
  end if;

  return public.tm_reserve_turn_quota(p_workspace_id, v_limit);
end $$;

revoke all on function public.tm_reserve_turn_quota_for_plan(uuid) from public, anon;
grant execute on function public.tm_reserve_turn_quota_for_plan(uuid) to authenticated;
