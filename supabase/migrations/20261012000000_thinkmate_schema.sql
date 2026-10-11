-- ThinkMate PostgreSQL Migration
-- Enables Row Level Security (RLS) for Thinking Sessions, Messages, Insights, and Workflow Transitions

-- 1. thinking_sessions table
CREATE TABLE IF NOT EXISTS public.thinking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  current_mode TEXT NOT NULL DEFAULT 'understand',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. session_messages table
CREATE TABLE IF NOT EXISTS public.session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.thinking_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'understand',
  suggested_questions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. session_insights table
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

-- 4. workflow_transitions table
CREATE TABLE IF NOT EXISTS public.workflow_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.thinking_sessions(id) ON DELETE CASCADE,
  from_mode TEXT NOT NULL,
  to_mode TEXT NOT NULL,
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

-- Clean up existing policies if re-running
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

-- Session RLS Policies
CREATE POLICY "Users can view own sessions"
  ON public.thinking_sessions FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert own sessions"
  ON public.thinking_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update own sessions"
  ON public.thinking_sessions FOR UPDATE
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own sessions"
  ON public.thinking_sessions FOR DELETE
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Session Messages Policies
CREATE POLICY "Users can view messages for own sessions"
  ON public.session_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_messages.session_id
      AND (s.user_id = auth.uid() OR s.user_id IS NULL)
    )
  );

CREATE POLICY "Users can insert messages for own sessions"
  ON public.session_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_messages.session_id
      AND (s.user_id = auth.uid() OR s.user_id IS NULL)
    )
  );

-- Session Insights Policies
CREATE POLICY "Users can view insights for own sessions"
  ON public.session_insights FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_insights.session_id
      AND (s.user_id = auth.uid() OR s.user_id IS NULL)
    )
  );

CREATE POLICY "Users can modify insights for own sessions"
  ON public.session_insights FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = session_insights.session_id
      AND (s.user_id = auth.uid() OR s.user_id IS NULL)
    )
  );

-- Workflow Transitions Policies
CREATE POLICY "Users can view transitions for own sessions"
  ON public.workflow_transitions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = workflow_transitions.session_id
      AND (s.user_id = auth.uid() OR s.user_id IS NULL)
    )
  );

CREATE POLICY "Users can insert transitions for own sessions"
  ON public.workflow_transitions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.thinking_sessions s
      WHERE s.id = workflow_transitions.session_id
      AND (s.user_id = auth.uid() OR s.user_id IS NULL)
    )
  );
