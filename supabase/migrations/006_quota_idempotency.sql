-- 006_quota_idempotency.sql: Usage Quotas & Client Message Idempotency

create or replace function public.tm_turns_last_day()
returns int language sql stable security invoker as $$
  select count(*)::int from public.tm_events e
  where e.event_type = 'turn' and e.created_at > now() - interval '1 day'
  and e.workspace_id in (select id from public.tm_workspaces where owner_id = (select auth.uid()));
$$;

alter table public.tm_messages add column if not exists client_msg_id uuid;

create unique index if not exists tm_messages_client_msg on public.tm_messages (workspace_id, client_msg_id)
where client_msg_id is not null;
