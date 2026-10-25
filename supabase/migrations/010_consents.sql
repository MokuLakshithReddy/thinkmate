-- 010_consents.sql
-- Records immutable user consent to Terms of Service and Privacy Policy

create table if not exists public.user_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document text not null check (document in ('terms', 'privacy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, document, version)
);

alter table public.user_consents enable row level security;

drop policy if exists user_consents_read on public.user_consents;
create policy user_consents_read on public.user_consents
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No client insert/update policy: only the server (service role / adminClient) records consent
