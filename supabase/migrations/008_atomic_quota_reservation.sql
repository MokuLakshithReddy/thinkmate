-- 008_atomic_quota_reservation.sql: Atomic Turn Quota Reservation Under Row Lock

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

  -- 1. Lock workspace row to serialize concurrent quota checks and turn requests
  SELECT owner_id INTO v_owner
  FROM public.tm_workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found: %', p_workspace_id;
  END IF;

  -- Verify access
  IF NOT public.tm_can_access(p_workspace_id, true) THEN
    RAISE EXCEPTION 'Access denied: %', p_workspace_id;
  END IF;

  -- 2. Count turns in the last 24h across all workspaces owned by this owner
  -- including any unexpired turn reservations (created within last 3 minutes)
  SELECT count(*)::int INTO v_used
  FROM public.tm_events e
  WHERE (
      e.event_type = 'turn'
      OR (e.event_type = 'turn_reservation' AND e.created_at > now() - interval '3 minutes')
    )
    AND e.created_at > now() - interval '1 day'
    AND e.workspace_id IN (SELECT id FROM public.tm_workspaces WHERE owner_id = v_owner);

  -- 3. Check boundary
  IF v_used >= p_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'used', v_used,
      'limit', p_daily_limit
    );
  END IF;

  -- 4. Atomically insert a reservation slot to prevent concurrent turns from exceeding limit
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
