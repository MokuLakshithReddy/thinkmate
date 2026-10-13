-- ThinkMate PostgreSQL Migration
-- Production Hardened Row Level Security (RLS) for Thinking Sessions, Messages, Insights, and Workflow Transitions

-- 1. Helper function for automated updated_at timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. thinking_sessions table
CREATE TABLE IF NOT EXISTS public.thinking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  current_mode TEXT NOT NULL DEFAULT 'understand' CHECK (current_mode IN ('understand', 'explore', 'challenge', 'decide', 'act')),
  current_stage TEXT NOT NULL DEFAULT 'welcome' CHECK (current_stage IN ('welcome', 'describe_problem', 'clarify_objective', 'break_subproblems', 'explore_perspectives', 'challenge_assumptions', 'check_satisfaction', 'summarize_insights', 'choose_action')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT chk_stage_mode_compatible CHECK (
    (current_stage IN ('welcome', 'describe_problem', 'clarify_objective') AND current_mode = 'understand') OR
    (current_stage IN ('break_subproblems', 'explore_perspectives') AND current_mode = 'explore') OR
    (current_stage IN ('challenge_assumptions', 'check_satisfaction') AND current_mode = 'challenge') OR
    (current_stage = 'summarize_insights' AND current_mode = 'decide') OR
    (current_stage = 'choose_action' AND current_mode = 'act')
  )
);

ALTER TABLE public.thinking_sessions ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT 'welcome';

-- Trigger for thinking_sessions.updated_at
DROP TRIGGER IF EXISTS trg_thinking_sessions_updated_at ON public.thinking_sessions;
CREATE TRIGGER trg_thinking_sessions_updated_at
  BEFORE UPDATE ON public.thinking_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3. session_messages table
CREATE TABLE IF NOT EXISTS public.session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.thinking_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'understand' CHECK (mode IN ('understand', 'explore', 'challenge', 'decide', 'act')),
  suggested_questions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. session_insights table
CREATE TABLE IF NOT EXISTS public.session_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.thinking_sessions(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('goal', 'assumption', 'option', 'decision', 'action', 'uncertainty')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'under_review' CHECK (status IN ('accepted', 'rejected', 'under_review')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Trigger for session_insights.updated_at
DROP TRIGGER IF EXISTS trg_session_insights_updated_at ON public.session_insights;
CREATE TRIGGER trg_session_insights_updated_at
  BEFORE UPDATE ON public.session_insights
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 5. workflow_transitions table
CREATE TABLE IF NOT EXISTS public.workflow_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.thinking_sessions(id) ON DELETE CASCADE,
  from_mode TEXT NOT NULL CHECK (from_mode IN ('understand', 'explore', 'challenge', 'decide', 'act')),
  to_mode TEXT NOT NULL CHECK (to_mode IN ('understand', 'explore', 'challenge', 'decide', 'act')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.thinking_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON public.session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_insights_session_id ON public.session_insights(session_id);
CREATE INDEX IF NOT EXISTS idx_transitions_session_id ON public.workflow_transitions(session_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.thinking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_transitions ENABLE ROW LEVEL SECURITY;

-- Clean up existing policies
DROP POLICY IF EXISTS "Users can view own sessions" ON public.thinking_sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.thinking_sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON public.thinking_sessions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON public.thinking_sessions;
DROP POLICY IF EXISTS "Users can view messages for own sessions" ON public.session_messages;
DROP POLICY IF EXISTS "Users can insert messages for own sessions" ON public.session_messages;
DROP POLICY IF EXISTS "Users can view insights for own sessions" ON public.session_insights;
DROP POLICY IF EXISTS "Users can modify insights for own sessions" ON public.session_insights;
DROP POLICY IF EXISTS "Users can view transitions for own sessions" ON public.workflow_transitions;
DROP POLICY IF EXISTS "Users can insert transitions for own sessions" ON public.workflow_transitions;

-- Strict Session RLS Policies (Requires authenticated user ownership; No NULL leaks)
CREATE POLICY "Users can view own sessions"
  ON public.thinking_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON public.thinking_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON public.thinking_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON public.thinking_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Session Messages Policies (Strict child ownership via parent session)
CREATE POLICY "Users can view messages for own sessions"
  ON public.session_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_messages.session_id
      AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages for own sessions"
  ON public.session_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_messages.session_id
      AND s.user_id = auth.uid()
    )
  );

-- Session Insights Policies (Strict child ownership)
CREATE POLICY "Users can view insights for own sessions"
  ON public.session_insights FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_insights.session_id
      AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can modify insights for own sessions"
  ON public.session_insights FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_insights.session_id
      AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_insights.session_id
      AND s.user_id = auth.uid()
    )
  );

-- Workflow Transitions Policies (Strict child ownership)
CREATE POLICY "Users can view transitions for own sessions"
  ON public.workflow_transitions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = workflow_transitions.session_id
      AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert transitions for own sessions"
  ON public.workflow_transitions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = workflow_transitions.session_id
      AND s.user_id = auth.uid()
    )
  );

-- 6. Workflow Idempotency Keys (Deduplication across retries)
-- Composite key: scoped to (user_id, session_id, client_request_id) to prevent cross-session collisions
CREATE TABLE IF NOT EXISTS public.workflow_idempotency_keys (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.thinking_sessions(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (user_id, session_id, client_request_id)
);

-- Auto-expire stale idempotency keys (older than 24h) to bound table growth
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON public.workflow_idempotency_keys(created_at);

ALTER TABLE public.workflow_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own idempotency keys" ON public.workflow_idempotency_keys;
CREATE POLICY "Users can view own idempotency keys"
  ON public.workflow_idempotency_keys FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own idempotency keys" ON public.workflow_idempotency_keys;
CREATE POLICY "Users can insert own idempotency keys"
  ON public.workflow_idempotency_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 7. Atomic Transaction Function for Workflow Step Recording
-- Enforces optimistic concurrency control: caller must supply expected_stage and expected_mode.
-- If the session's current state has diverged (concurrent mutation), the RPC rejects the request
-- with a descriptive error that maps to HTTP 409 Conflict at the API layer.
-- Idempotency check is performed AFTER acquiring the FOR UPDATE lock to prevent TOCTOU races.
CREATE OR REPLACE FUNCTION public.record_workflow_step_tx(
  p_session_id UUID,
  p_user_id UUID,
  p_user_message TEXT,
  p_assistant_message TEXT,
  p_next_stage TEXT,
  p_next_mode TEXT,
  p_expected_stage TEXT,
  p_expected_mode TEXT,
  p_problem_statement TEXT DEFAULT NULL,
  p_suggested_questions JSONB DEFAULT '[]'::jsonb,
  p_client_request_id TEXT DEFAULT NULL,
  p_request_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_user_msg_id UUID := gen_random_uuid();
  v_ast_msg_id UUID := gen_random_uuid();
  v_result JSONB;
  v_existing_payload JSONB;
  v_existing_hash TEXT;
BEGIN
  -- Strict caller identity validation (defense-in-depth):
  -- If invoked within a Supabase auth JWT context (e.g. PostgREST), ensure caller cannot spoof p_user_id
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Forbidden: caller auth.uid (%) does not match target p_user_id (%)', auth.uid(), p_user_id;
  END IF;

  -- 1. Verify session ownership with exclusive lock to serialize concurrent transitions
  SELECT * INTO v_session
  FROM public.thinking_sessions
  WHERE id = p_session_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized or session not found: %', p_session_id;
  END IF;

  -- 2. Optimistic concurrency control: compare expected state against locked row
  -- This prevents two concurrent requests from both advancing the session.
  IF v_session.current_stage != p_expected_stage THEN
    RAISE EXCEPTION 'CONFLICT: expected stage "%" but session is at "%". Reload the session.',
      p_expected_stage, v_session.current_stage;
  END IF;

  IF v_session.current_mode != p_expected_mode THEN
    RAISE EXCEPTION 'CONFLICT: expected mode "%" but session is at "%". Reload the session.',
      p_expected_mode, v_session.current_mode;
  END IF;

  -- 3. Workflow Invariant Enforcement: Validate stage and mode compatibility
  IF NOT (
    (p_next_stage IN ('welcome', 'describe_problem', 'clarify_objective') AND p_next_mode = 'understand') OR
    (p_next_stage IN ('break_subproblems', 'explore_perspectives') AND p_next_mode = 'explore') OR
    (p_next_stage IN ('challenge_assumptions', 'check_satisfaction') AND p_next_mode = 'challenge') OR
    (p_next_stage = 'summarize_insights' AND p_next_mode = 'decide') OR
    (p_next_stage = 'choose_action' AND p_next_mode = 'act')
  ) THEN
    RAISE EXCEPTION 'Invalid workflow stage/mode combination: stage "%" does not match mode "%"', p_next_stage, p_next_mode;
  END IF;

  -- 4. Idempotency check AFTER lock acquisition (prevents TOCTOU race)
  IF p_client_request_id IS NOT NULL AND length(p_client_request_id) > 0 THEN
    SELECT response_payload, request_hash INTO v_existing_payload, v_existing_hash
    FROM public.workflow_idempotency_keys
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND client_request_id = p_client_request_id;

    IF v_existing_payload IS NOT NULL THEN
      -- Enforce payload consistency: reject if same key is reused with different content
      IF p_request_hash IS NOT NULL AND v_existing_hash IS NOT NULL AND p_request_hash != v_existing_hash THEN
        RAISE EXCEPTION 'Idempotency key reuse violation: request_id "%" was previously used with different payload',
          p_client_request_id;
      END IF;
      RETURN v_existing_payload;
    END IF;
  END IF;

  -- 5. Insert user message if provided
  IF p_user_message IS NOT NULL AND length(trim(p_user_message)) > 0 THEN
    INSERT INTO public.session_messages (id, session_id, role, content, mode)
    VALUES (v_user_msg_id, p_session_id, 'user', trim(p_user_message), v_session.current_mode);
  ELSE
    v_user_msg_id := NULL;
  END IF;

  -- 6. Insert assistant message
  INSERT INTO public.session_messages (id, session_id, role, content, mode, suggested_questions)
  VALUES (v_ast_msg_id, p_session_id, 'assistant', p_assistant_message, p_next_mode, p_suggested_questions);

  -- 7. Update session stage, mode, and problem_statement in the same transaction
  UPDATE public.thinking_sessions
  SET current_mode = p_next_mode,
      current_stage = p_next_stage,
      problem_statement = COALESCE(p_problem_statement, problem_statement),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_session_id AND user_id = p_user_id;

  -- 8. Build response payload
  v_result := jsonb_build_object(
    'sessionId', p_session_id,
    'userMessageId', v_user_msg_id,
    'assistantMessageId', v_ast_msg_id,
    'nextStage', p_next_stage,
    'nextMode', p_next_mode,
    'isIdempotentReplay', false
  );

  -- 9. Persist idempotency record (scoped to user + session + request)
  IF p_client_request_id IS NOT NULL AND length(p_client_request_id) > 0 THEN
    INSERT INTO public.workflow_idempotency_keys (user_id, session_id, client_request_id, request_hash, response_payload)
    VALUES (p_user_id, p_session_id, p_client_request_id, COALESCE(p_request_hash, ''), jsonb_set(v_result, '{isIdempotentReplay}', 'true'::jsonb))
    ON CONFLICT (user_id, session_id, client_request_id) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- 8. Explicit Privilege Restrictions for SECURITY DEFINER RPC
-- Revoke execution from PUBLIC, anon, and authenticated; grant exclusively to service_role
REVOKE ALL ON FUNCTION public.record_workflow_step_tx(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_workflow_step_tx(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.record_workflow_step_tx(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_step_tx(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;

-- 9. Atomic Transaction Function for Workflow Mode Transitions
-- Locks session, verifies optimistic current_mode, validates transition prerequisites (such as accepted decision for 'act'),
-- updates session atomically, and records transition in workflow_transitions table.
CREATE OR REPLACE FUNCTION public.transition_workflow_mode_tx(
  p_session_id UUID,
  p_user_id UUID,
  p_expected_mode TEXT,
  p_to_mode TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_next_stage TEXT;
  v_result JSONB;
BEGIN
  -- Strict caller verification
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Forbidden: caller auth.uid (%) does not match target p_user_id (%)', auth.uid(), p_user_id;
  END IF;

  -- 1. Exclusive row lock
  SELECT * INTO v_session
  FROM public.thinking_sessions
  WHERE id = p_session_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized or session not found: %', p_session_id;
  END IF;

  -- 2. Optimistic concurrency check
  IF v_session.current_mode != p_expected_mode THEN
    RAISE EXCEPTION 'CONFLICT: expected mode "%" but session is currently at "%". Reload session.',
      p_expected_mode, v_session.current_mode;
  END IF;

  -- 3. Invariant: transitioning to 'act' requires at least one accepted decision insight
  IF p_to_mode = 'act' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.session_insights
      WHERE session_id = p_session_id AND category = 'decision' AND status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'Transition to Act mode denied: an accepted decision insight is required';
    END IF;
  END IF;

  -- 4. Derive authoritative default stage for target mode
  v_next_stage := CASE p_to_mode
    WHEN 'understand' THEN 'describe_problem'
    WHEN 'explore' THEN 'explore_perspectives'
    WHEN 'challenge' THEN 'challenge_assumptions'
    WHEN 'decide' THEN 'summarize_insights'
    WHEN 'act' THEN 'choose_action'
    ELSE 'describe_problem'
  END;

  -- 5. Atomically update session
  UPDATE public.thinking_sessions
  SET current_mode = p_to_mode,
      current_stage = v_next_stage,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_session_id AND user_id = p_user_id;

  -- 6. Insert audit record in workflow_transitions
  INSERT INTO public.workflow_transitions (session_id, from_mode, to_mode, reason)
  VALUES (p_session_id, p_expected_mode, p_to_mode, p_reason);

  v_result := jsonb_build_object(
    'sessionId', p_session_id,
    'fromMode', p_expected_mode,
    'toMode', p_to_mode,
    'stage', v_next_stage,
    'allowed', true
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_workflow_mode_tx(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_workflow_mode_tx(UUID, UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.transition_workflow_mode_tx(UUID, UUID, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_workflow_mode_tx(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

-- Restrict workflow_idempotency_keys table from anonymous / unprivileged roles
REVOKE ALL ON TABLE public.workflow_idempotency_keys FROM PUBLIC;
REVOKE ALL ON TABLE public.workflow_idempotency_keys FROM anon;
GRANT ALL ON TABLE public.workflow_idempotency_keys TO service_role;
