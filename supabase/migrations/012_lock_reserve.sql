-- 012_lock_reserve.sql
-- Lock down direct access to low-level tm_reserve_turn_quota so clients cannot supply arbitrary limits.
-- All clients must execute tm_reserve_turn_quota_for_plan(uuid).

revoke execute on function public.tm_reserve_turn_quota(uuid, int) from public, anon, authenticated;
