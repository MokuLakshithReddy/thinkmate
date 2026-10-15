-- Migration: 20261015000000_enforce_workflow_decision_gate.sql
-- Description: Forward-only migration enforcing accepted-decision gate in record_workflow_step_tx
-- Ensures sessions cannot transition to Act mode or choose_action without an accepted decision insight.

-- 1. Redefine record_workflow_step_tx with mandatory accepted-decision gate
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
  p_request_hash TEXT DEFAULT NULL,
  p_client_response JSONB DEFAULT NULL
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
  v_has_accepted_decision BOOLEAN := FALSE;
BEGIN
  -- Caller verification
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Forbidden: caller auth.uid (%) does not match target p_user_id (%)', auth.uid(), p_user_id;
  END IF;

  -- 1. Acquire exclusive FOR UPDATE lock on session
  SELECT * INTO v_session
  FROM public.thinking_sessions
  WHERE id = p_session_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized or session not found: %', p_session_id;
  END IF;

  -- 2. Idempotency Check UNDER LOCK BEFORE Concurrency Check
  -- If this is a genuine retry, the session stage was already updated by the 1st request.
  -- Checking idempotency first prevents a false optimistic concurrency conflict on valid retries.
  IF p_client_request_id IS NOT NULL AND length(p_client_request_id) > 0 THEN
    SELECT response_payload, request_hash INTO v_existing_payload, v_existing_hash
    FROM public.workflow_idempotency_keys
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND client_request_id = p_client_request_id;

    IF v_existing_payload IS NOT NULL THEN
      -- Validate payload hash consistency: require existing hash to be non-empty and equal
      IF p_request_hash IS NOT NULL AND p_request_hash != '' THEN
        IF v_existing_hash IS NULL OR v_existing_hash = '' OR p_request_hash != v_existing_hash THEN
          RAISE EXCEPTION 'Idempotency key reuse violation: request_id "%" was previously used with different or unverified payload',
            p_client_request_id;
        END IF;
      END IF;
      RETURN v_existing_payload;
    END IF;
  END IF;

  -- 3. Optimistic Concurrency Control: compare expected state against locked row
  IF v_session.current_stage != p_expected_stage THEN
    RAISE EXCEPTION 'CONFLICT: expected stage "%" but session is at "%". Reload the session.',
      p_expected_stage, v_session.current_stage;
  END IF;

  IF v_session.current_mode != p_expected_mode THEN
    RAISE EXCEPTION 'CONFLICT: expected mode "%" but session is at "%". Reload the session.',
      p_expected_mode, v_session.current_mode;
  END IF;

  -- 4. Workflow Invariant Enforcement: Validate stage and mode compatibility
  IF NOT (
    (p_next_stage IN ('welcome', 'describe_problem', 'clarify_objective') AND p_next_mode = 'understand') OR
    (p_next_stage IN ('break_subproblems', 'explore_perspectives') AND p_next_mode = 'explore') OR
    (p_next_stage IN ('challenge_assumptions', 'check_satisfaction') AND p_next_mode = 'challenge') OR
    (p_next_stage = 'summarize_insights' AND p_next_mode = 'decide') OR
    (p_next_stage = 'choose_action' AND p_next_mode = 'act')
  ) THEN
    RAISE EXCEPTION 'Invalid workflow stage/mode combination: stage "%" does not match mode "%"', p_next_stage, p_next_mode;
  END IF;

  -- 4b. Accepted Decision Gate: Moving to Act mode or choose_action requires at least one accepted decision
  IF p_next_mode = 'act' OR p_next_stage = 'choose_action' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.session_insights i
      WHERE i.session_id = p_session_id
        AND i.category = 'decision'
        AND i.status = 'accepted'
    ) INTO v_has_accepted_decision;

    IF NOT v_has_accepted_decision THEN
      RAISE EXCEPTION 'Transition denied: Moving to Act mode or choose_action requires at least one accepted decision insight';
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

  -- 8. Build complete response payload
  IF p_client_response IS NOT NULL THEN
    v_result := p_client_response;
    v_result := jsonb_set(v_result, '{sessionId}', to_jsonb(p_session_id));
    v_result := jsonb_set(v_result, '{assistantMessageId}', to_jsonb(v_ast_msg_id));
    v_result := jsonb_set(v_result, '{nextStage}', to_jsonb(p_next_stage));
    v_result := jsonb_set(v_result, '{nextMode}', to_jsonb(p_next_mode));
    IF v_user_msg_id IS NOT NULL THEN
      v_result := jsonb_set(v_result, '{userMessageId}', to_jsonb(v_user_msg_id));
    END IF;
  ELSE
    v_result := jsonb_build_object(
      'sessionId', p_session_id,
      'userMessageId', v_user_msg_id,
      'assistantMessageId', v_ast_msg_id,
      'message', p_assistant_message,
      'nextStep', p_next_stage,
      'nextStage', p_next_stage,
      'nextMode', p_next_mode,
      'options', p_suggested_questions,
      'progressPercent', 10,
      'executionMode', 'gemini'
    );
  END IF;
  v_result := jsonb_set(v_result, '{isIdempotentReplay}', 'false'::jsonb);

  -- 9. Persist complete response into idempotency keys
  IF p_client_request_id IS NOT NULL AND length(p_client_request_id) > 0 THEN
    INSERT INTO public.workflow_idempotency_keys (user_id, session_id, client_request_id, request_hash, response_payload)
    VALUES (
      p_user_id,
      p_session_id,
      p_client_request_id,
      COALESCE(p_request_hash, ''),
      jsonb_set(v_result, '{isIdempotentReplay}', 'true'::jsonb)
    )
    ON CONFLICT (user_id, session_id, client_request_id) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- Privileges for record_workflow_step_tx
REVOKE ALL ON FUNCTION public.record_workflow_step_tx(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_workflow_step_tx(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.record_workflow_step_tx(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_step_tx(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) TO service_role;
