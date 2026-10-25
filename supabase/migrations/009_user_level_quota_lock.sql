-- 009_user_level_quota_lock.sql: User-Level Serialization for Daily Turn Quota

-- 1. Create dedicated per-user quota table to serialize across all workspaces of a user
CREATE TABLE IF NOT EXISTS public.tm_user_quotas (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS and add owner read policy for security audit compliance
ALTER TABLE public.tm_user_quotas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tm_user_quotas' AND policyname = 'tm_user_quotas_owner_read'
  ) THEN
    CREATE POLICY "tm_user_quotas_owner_read"
      ON public.tm_user_quotas
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- 2. Update tm_reserve_turn_quota with user-level serialization lock
CREATE OR REPLACE FUNCTION public.tm_reserve_turn_quota(
  p_workspace_id UUID,
  p_daily_limit INT DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_owner UUID;
  v_used INT;
  v_reservation_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Identify owner of the workspace and verify access
  SELECT owner_id INTO v_owner
  FROM public.tm_workspaces
  WHERE id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found: %', p_workspace_id;
  END IF;

  IF NOT public.tm_can_access(p_workspace_id, true) THEN
    RAISE EXCEPTION 'Access denied: %', p_workspace_id;
  END IF;

  -- 2. USER-LEVEL EXCLUSIVE LOCK
  -- We serialize quota checks across ALL workspaces owned by v_owner.
  -- Even if requests target Workspace A and Workspace B simultaneously,
  -- both MUST acquire the exclusive row lock on v_owner in tm_user_quotas.
  INSERT INTO public.tm_user_quotas (user_id, last_reserved_at)
  VALUES (v_owner, now())
  ON CONFLICT (user_id) DO UPDATE SET last_reserved_at = now();

  PERFORM 1
  FROM public.tm_user_quotas
  WHERE user_id = v_owner
  FOR UPDATE;

  -- 3. Also lock the workspace row for workspace-level turn sequencing
  PERFORM 1
  FROM public.tm_workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;

  -- 4. Count turns in the last 24h across ALL workspaces owned by v_owner
  -- including unexpired reservations (created within last 3 minutes)
  SELECT count(*)::int INTO v_used
  FROM public.tm_events e
  WHERE (
      e.event_type = 'turn'
      OR (e.event_type = 'turn_reservation' AND e.created_at > now() - interval '3 minutes')
    )
    AND e.created_at > now() - interval '1 day'
    AND e.workspace_id IN (SELECT id FROM public.tm_workspaces WHERE owner_id = v_owner);

  -- 5. Strict boundary check
  IF v_used >= p_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'used', v_used,
      'limit', p_daily_limit
    );
  END IF;

  -- 6. Atomically insert reservation slot
  INSERT INTO public.tm_events (workspace_id, event_type, payload)
  VALUES (
    p_workspace_id,
    'turn_reservation',
    jsonb_build_object('reserved_by', v_uid, 'reserved_at', extract(epoch from now()))
  )
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id,
    'used', v_used + 1,
    'limit', p_daily_limit
  );
END;
$$;
