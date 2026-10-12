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
  current_stage TEXT NOT NULL DEFAULT 'welcome',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
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
CREATE TABLE IF NOT EXISTS public.workflow_idempotency_keys (
  client_request_id TEXT PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.thinking_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.workflow_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own idempotency keys"
  ON public.workflow_idempotency_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own idempotency keys"
  ON public.workflow_idempotency_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 7. Atomic Transaction Function for Workflow Step Recording
CREATE OR REPLACE FUNCTION public.record_workflow_step_tx(
  p_session_id UUID,
  p_user_id UUID,
  p_user_message TEXT,
  p_assistant_message TEXT,
  p_next_stage TEXT,
  p_next_mode TEXT,
  p_problem_statement TEXT DEFAULT NULL,
  p_suggested_questions JSONB DEFAULT '[]'::jsonb,
  p_client_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session RECORD;
  v_user_msg_id UUID := gen_random_uuid();
  v_ast_msg_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- 1. Idempotency check if client_request_id is provided
  IF p_client_request_id IS NOT NULL AND length(p_client_request_id) > 0 THEN
    SELECT response_payload INTO v_result
    FROM public.workflow_idempotency_keys
    WHERE client_request_id = p_client_request_id AND user_id = p_user_id;

    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  -- 2. Verify session ownership with exclusive lock to serialize concurrent transitions
  SELECT * INTO v_session
  FROM public.thinking_sessions
  WHERE id = p_session_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized or session not found: %', p_session_id;
  END IF;

  -- 3. Insert user message if provided
  IF p_user_message IS NOT NULL AND length(trim(p_user_message)) > 0 THEN
    INSERT INTO public.session_messages (id, session_id, role, content, mode)
    VALUES (v_user_msg_id, p_session_id, 'user', trim(p_user_message), v_session.current_mode);
  ELSE
    v_user_msg_id := NULL;
  END IF;

  -- 4. Insert assistant message
  INSERT INTO public.session_messages (id, session_id, role, content, mode, suggested_questions)
  VALUES (v_ast_msg_id, p_session_id, 'assistant', p_assistant_message, p_next_mode, p_suggested_questions);

  -- 5. Update session stage, mode, and problem_statement in the same transaction
  UPDATE public.thinking_sessions
  SET current_mode = p_next_mode,
      current_stage = p_next_stage,
      problem_statement = COALESCE(p_problem_statement, problem_statement),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_session_id AND user_id = p_user_id;

  -- 6. Build response payload
  v_result := jsonb_build_object(
    'sessionId', p_session_id,
    'userMessageId', v_user_msg_id,
    'assistantMessageId', v_ast_msg_id,
    'nextStage', p_next_stage,
    'nextMode', p_next_mode,
    'isIdempotentReplay', false
  );

  -- 7. Persist idempotency record
  IF p_client_request_id IS NOT NULL AND length(p_client_request_id) > 0 THEN
    INSERT INTO public.workflow_idempotency_keys (client_request_id, session_id, user_id, response_payload)
    VALUES (p_client_request_id, p_session_id, p_user_id, jsonb_set(v_result, '{isIdempotentReplay}', 'true'::jsonb))
    ON CONFLICT (client_request_id) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;
