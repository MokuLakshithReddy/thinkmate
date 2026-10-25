-- 007_atomic_turn_rpc.sql: Atomic Transactions for Guided Reasoning Turns & Proposed Updates

-- 1. Atomic Transaction Function for Reasoning Turns
CREATE OR REPLACE FUNCTION public.tm_apply_turn_tx(
  p_workspace_id UUID,
  p_user_message TEXT,
  p_assistant_reply TEXT,
  p_guidance_mode TEXT DEFAULT NULL,
  p_policy_action TEXT DEFAULT NULL,
  p_proposed_items JSONB DEFAULT '[]'::jsonb,
  p_proposed_problem_frame TEXT DEFAULT NULL,
  p_client_msg_id UUID DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ws RECORD;
  v_user_msg RECORD;
  v_ast_msg RECORD;
  v_user_msg_id UUID;
  v_ast_msg_id UUID;
  v_item JSONB;
  v_seen_item BOOLEAN;
  v_inserted_items INT := 0;
BEGIN
  -- 1. Check workspace access (caller must have write access or ownership)
  IF NOT public.tm_can_access(p_workspace_id, true) THEN
    RAISE EXCEPTION 'Workspace not found or access denied: %', p_workspace_id;
  END IF;

  -- 2. Lock workspace row to serialize concurrent turns and prevent races
  SELECT * INTO v_ws
  FROM public.tm_workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found: %', p_workspace_id;
  END IF;

  -- 3. Idempotency Check UNDER LOCK
  IF p_client_msg_id IS NOT NULL THEN
    SELECT * INTO v_user_msg
    FROM public.tm_messages
    WHERE workspace_id = p_workspace_id
      AND client_msg_id = p_client_msg_id
    LIMIT 1;

    IF FOUND THEN
      -- Specifically find the assistant message that directly responded to this user turn
      SELECT * INTO v_ast_msg
      FROM public.tm_messages
      WHERE workspace_id = p_workspace_id
        AND seq > v_user_msg.seq
        AND role = 'assistant'
      ORDER BY seq ASC
      LIMIT 1;

      RETURN jsonb_build_object(
        'idempotent_replay', true,
        'user_message_id', v_user_msg.id,
        'assistant_message_id', v_ast_msg.id,
        'assistant_reply', COALESCE(v_ast_msg.content, 'Turn already processed.'),
        'guidance_mode', v_ast_msg.guidance_mode,
        'policy_action', v_ast_msg.policy_action,
        'proposed_count', 0
      );
    END IF;
  END IF;

  -- 4. Insert User Message
  INSERT INTO public.tm_messages (workspace_id, role, content, client_msg_id)
  VALUES (p_workspace_id, 'user', p_user_message, p_client_msg_id)
  RETURNING id INTO v_user_msg_id;

  -- 5. Insert Assistant Message
  INSERT INTO public.tm_messages (workspace_id, role, content, guidance_mode, policy_action)
  VALUES (p_workspace_id, 'assistant', p_assistant_reply, p_guidance_mode, p_policy_action)
  RETURNING id INTO v_ast_msg_id;

  -- 6. Insert Proposed Items (deduplicated against existing workspace items)
  IF p_proposed_items IS NOT NULL AND jsonb_array_length(p_proposed_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_proposed_items)
    LOOP
      SELECT EXISTS (
        SELECT 1 FROM public.tm_items
        WHERE workspace_id = p_workspace_id
          AND kind = (v_item->>'kind')
          AND lower(trim(text)) = lower(trim(v_item->>'text'))
      ) INTO v_seen_item;

      IF NOT v_seen_item THEN
        INSERT INTO public.tm_items (workspace_id, kind, text, origin, status, meta)
        VALUES (
          p_workspace_id,
          v_item->>'kind',
          v_item->>'text',
          COALESCE(v_item->>'origin', 'ai'),
          'proposed',
          COALESCE(v_item->'meta', '{}'::jsonb)
        );
        v_inserted_items := v_inserted_items + 1;
      END IF;
    END LOOP;
  END IF;

  -- 7. Update Problem Frame (if proposed)
  IF p_proposed_problem_frame IS NOT NULL AND length(trim(p_proposed_problem_frame)) > 0 THEN
    UPDATE public.tm_workspaces
    SET proposed_problem_frame = p_proposed_problem_frame,
        updated_at = now()
    WHERE id = p_workspace_id;
  ELSE
    UPDATE public.tm_workspaces
    SET updated_at = now()
    WHERE id = p_workspace_id;
  END IF;

  -- 8. Record Turn Event Atomically in the same transaction
  INSERT INTO public.tm_events (workspace_id, event_type, payload)
  VALUES (
    p_workspace_id,
    'turn',
    COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object(
      'guidance_mode', p_guidance_mode,
      'policy_action', p_policy_action,
      'proposed', v_inserted_items
    )
  );

  RETURN jsonb_build_object(
    'idempotent_replay', false,
    'user_message_id', v_user_msg_id,
    'assistant_message_id', v_ast_msg_id,
    'assistant_reply', p_assistant_reply,
    'guidance_mode', p_guidance_mode,
    'policy_action', p_policy_action,
    'proposed_count', v_inserted_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tm_apply_turn_tx(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tm_apply_turn_tx(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, JSONB) TO authenticated, service_role;


-- 2. Atomic Transaction Function for MCP Propose Updates
CREATE OR REPLACE FUNCTION public.tm_propose_update_tx(
  p_workspace_id UUID,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_problem_frame TEXT DEFAULT NULL,
  p_audit_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ws RECORD;
  v_item JSONB;
  v_inserted_items INT := 0;
BEGIN
  -- 1. Check workspace access
  IF NOT public.tm_can_access(p_workspace_id, true) THEN
    RAISE EXCEPTION 'Workspace not found or access denied: %', p_workspace_id;
  END IF;

  -- 2. Lock workspace row
  SELECT * INTO v_ws
  FROM public.tm_workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found: %', p_workspace_id;
  END IF;

  -- 3. Insert items
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.tm_items (workspace_id, kind, text, origin, status, meta)
      VALUES (
        p_workspace_id,
        v_item->>'kind',
        v_item->>'text',
        'ai',
        'proposed',
        jsonb_build_object('via', 'mcp')
      );
      v_inserted_items := v_inserted_items + 1;
    END LOOP;
  END IF;

  -- 4. Update Problem Frame
  IF p_problem_frame IS NOT NULL AND length(trim(p_problem_frame)) > 0 THEN
    UPDATE public.tm_workspaces
    SET proposed_problem_frame = p_problem_frame,
        updated_at = now()
    WHERE id = p_workspace_id;
  END IF;

  -- 5. Audit event
  INSERT INTO public.tm_events (workspace_id, event_type, payload)
  VALUES (
    p_workspace_id,
    'mcp_propose',
    COALESCE(p_audit_payload, '{}'::jsonb) || jsonb_build_object('items', v_inserted_items)
  );

  RETURN jsonb_build_object(
    'success', true,
    'items_count', v_inserted_items,
    'frame_updated', p_problem_frame IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tm_propose_update_tx(UUID, JSONB, TEXT, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tm_propose_update_tx(UUID, JSONB, TEXT, JSONB) TO authenticated, service_role;
