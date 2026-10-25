import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { ThinkingSession, SessionMessage, Insight, ThinkingMode, CoThinkerStep, ChoiceOption, InsightCategory, InsightStatus, normalizeInsightCategory, normalizeInsightStatus } from '@/types';
import { getServiceSupabaseClient } from './supabase-client';

export interface RecordWorkflowStepParams {
  sessionId: string;
  userMessage?: string;
  userName?: string;
  assistantMessage: string;
  nextStage: CoThinkerStep;
  nextMode: ThinkingMode;
  expectedStage: CoThinkerStep;
  expectedMode: ThinkingMode;
  problemStatement?: string;
  suggestedQuestions?: string[];
  clientRequestId?: string;
  clientResponse?: Record<string, unknown>;
  requestHash?: string;
  selectedOptionId?: string;
  clarifiedObjective?: string;
  model?: string;
}

export interface RecordWorkflowStepResult {
  sessionId: string;
  userMessageId?: string;
  assistantMessageId: string;
  nextStage: CoThinkerStep;
  nextMode: ThinkingMode;
  isConflict?: boolean;
  message?: string;
  nextStep?: CoThinkerStep;
  options?: ChoiceOption[];
  progressPercent?: number;
  executionMode?: 'gemini' | 'simulator' | 'error';
  modelName?: string;
  simulatedNotice?: string;
  isIdempotentReplay?: boolean;
  clientResponse?: Record<string, unknown>;
}

export interface TransitionModeParams {
  sessionId: string;
  expectedMode: ThinkingMode;
  toMode: ThinkingMode;
  reason?: string;
}

export interface TransitionModeResult {
  sessionId: string;
  fromMode: ThinkingMode;
  toMode: ThinkingMode;
  stage: CoThinkerStep;
  allowed: boolean;
  isConflict?: boolean;
}

export interface ThinkingRepository {
  getSessions(userId: string): Promise<ThinkingSession[]>;
  getSession(id: string, userId: string): Promise<ThinkingSession | null>;
  createSession(session: ThinkingSession, userId: string): Promise<ThinkingSession>;
  updateSession(id: string, updates: Partial<ThinkingSession>, userId: string): Promise<ThinkingSession>;
  recordWorkflowStep(params: RecordWorkflowStepParams, userId: string): Promise<RecordWorkflowStepResult>;
  getIdempotencyRecord(sessionId: string, userId: string, clientRequestId: string, expectedRequestHash?: string): Promise<RecordWorkflowStepResult | null>;
  transitionMode(params: TransitionModeParams, userId: string): Promise<TransitionModeResult>;
  deleteSession(id: string, userId: string): Promise<void>;
  deleteAllUserSessions(userId: string): Promise<number>;
  getMessages(sessionId: string, userId: string): Promise<SessionMessage[]>;
  addMessage(message: SessionMessage, userId: string): Promise<SessionMessage>;
  getInsights(sessionId: string, userId: string): Promise<Insight[]>;
  upsertInsight(insight: Insight, userId: string): Promise<Insight>;
  deleteInsight(id: string, userId: string): Promise<void>;
}

/**
 * Bounded LRU cache with TTL expiration to prevent memory leaks in long-running processes.
 */
export class BoundedLruCache<K, V> {
  private maxSize: number;
  private ttlMs: number;
  private map = new Map<K, { value: V; expiresAt: number }>();

  constructor(maxSize: number = 500, ttlMs: number = 600000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.map.clear();
  }
}

export interface CachedIdempotencyEntry {
  result: RecordWorkflowStepResult;
  requestHash: string;
}

/**
 * Generates a deterministic hash for idempotency payload consistency enforcement.
 * Ensures the same clientRequestId cannot be reused with different message content, parameters, or workflow targets.
 * Explicitly covers all semantically relevant request fields:
 * - sessionId: Target session identifier
 * - step / expectedStage: Current workflow stage
 * - expectedMode: Current thinking mode
 * - userMessage: Content of the user prompt
 * - userName: User name provided to personalize or guide the reasoning engine
 * - selectedOptionId: Follow-up question/option selected by the user
 * - problemStatement: Underlying problem definition
 * - clarifiedObjective: Clarified objective for the session
 * - model: Selected AI model for processing
 * - nextStage: Proposed destination stage
 * - nextMode: Proposed destination mode
 * Uses cryptographic SHA-256 with canonical key sorting to guarantee collision resistance.
 */
export function computeRequestHash(params: {
  sessionId: string;
  step?: string;
  userMessage?: string;
  userName?: string;
  selectedOptionId?: string;
  problemStatement?: string;
  clarifiedObjective?: string;
  model?: string;
  expectedStage?: CoThinkerStep;
  expectedMode?: ThinkingMode;
  nextStage?: CoThinkerStep;
  nextMode?: ThinkingMode;
}): string {
  // Canonical structured payload with stable, alphabetically sorted keys
  const canonicalObj = {
    clarifiedObjective: params.clarifiedObjective?.trim() || '',
    expectedMode: params.expectedMode || '',
    expectedStage: params.step || params.expectedStage || '',
    model: params.model || '',
    nextMode: params.nextMode || '',
    nextStage: params.nextStage || '',
    problemStatement: params.problemStatement?.trim() || '',
    selectedOptionId: params.selectedOptionId || '',
    sessionId: params.sessionId,
    userMessage: params.userMessage?.trim() || '',
    userName: params.userName?.trim() || '',
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalObj))
    .digest('hex');
}

/**
 * Whether the current runtime is considered production.
 * In production, the non-transactional fallback is disabled (fail closed).
 */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.FAIL_CLOSED_WORKFLOW === 'true';
}

export class SupabaseThinkingRepository implements ThinkingRepository {
  private client: SupabaseClient;
  public static idempotencyCache = new BoundedLruCache<string, CachedIdempotencyEntry>(500, 600000);

  constructor(customClient?: SupabaseClient) {
    this.client = customClient || getServiceSupabaseClient();
  }

  /**
   * Retrieves an existing idempotency record scoped to user, session, and request ID.
   * Checks the in-memory bounded LRU cache first, followed by the database table.
   * Validates request hash to prevent payload substitution attacks under cached entries.
   * Rejects missing or empty stored hashes when an expected hash is provided to prevent legacy payload confusion.
   * Rethrows database query errors rather than silently treating them as cache misses.
   */
  async getIdempotencyRecord(
    sessionId: string,
    userId: string,
    clientRequestId: string,
    expectedRequestHash?: string
  ): Promise<RecordWorkflowStepResult | null> {
    if (!userId || !sessionId || !clientRequestId) return null;
    const cacheKey = `${userId}:${sessionId}:${clientRequestId}`;
    const cached = SupabaseThinkingRepository.idempotencyCache.get(cacheKey);
    if (cached) {
      if (expectedRequestHash) {
        if (!cached.requestHash || cached.requestHash !== expectedRequestHash) {
          throw new Error(
            `Idempotency key reuse violation: clientRequestId "${clientRequestId}" was previously used with different or missing payload hash`
          );
        }
      }
      return {
        ...cached.result,
        isIdempotentReplay: true,
      };
    }

    if (this.client && typeof (this.client as unknown as Record<string, unknown>).from === 'function') {
      try {
        const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        let query = this.client
          .from('workflow_idempotency_keys')
          .select('response_payload, request_hash, created_at')
          .eq('user_id', userId)
          .eq('session_id', sessionId)
          .eq('client_request_id', clientRequestId);

        if (typeof (query as unknown as Record<string, unknown>).gt === 'function') {
          query = (query as unknown as { gt: (col: string, val: string) => typeof query }).gt('created_at', cutoff24h);
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
          throw new Error(`Database failure looking up idempotency record: ${error.message}`);
        }

        if (data?.created_at && new Date(data.created_at as string).getTime() < new Date(cutoff24h).getTime()) {
          return null;
        }

        if (data?.response_payload) {
          if (expectedRequestHash) {
            // When an expected hash is supplied, reject records with a missing or empty stored hash
            if (!data.request_hash || data.request_hash !== expectedRequestHash) {
              throw new Error(
                `Idempotency key reuse violation: clientRequestId "${clientRequestId}" was previously used with different or missing payload hash`
              );
            }
          }
          const payload = data.response_payload as RecordWorkflowStepResult;
          SupabaseThinkingRepository.idempotencyCache.set(cacheKey, {
            result: payload,
            requestHash: data.request_hash || expectedRequestHash || '',
          });
          return {
            ...payload,
            isIdempotentReplay: true,
          };
        }
      } catch (err) {
        if (err instanceof Error) {
          if (
            err.message.includes('Idempotency key reuse violation') ||
            err.message.includes('Database failure looking up idempotency record')
          ) {
            throw err;
          }
        }
        throw err;
      }
    }
    return null;
  }

  /**
   * Bounded cleanup mechanism for expired idempotency records (> 24 hours).
   * Prevents unbounded table growth in workflow_idempotency_keys.
   */
  async cleanupExpiredIdempotencyKeys(maxAgeHours = 24): Promise<number> {
    if (!this.client || typeof (this.client as unknown as Record<string, unknown>).from !== 'function') return 0;
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from('workflow_idempotency_keys')
      .delete()
      .lt('created_at', cutoff)
      .select('id');
    if (error) {
      console.warn('[Repository] Failed to clean up expired idempotency keys:', error);
      return 0;
    }
    return data?.length ?? 0;
  }

  /**
   * Retrieves all thinking sessions belonging exclusively to the verified user.
   */
  async getSessions(userId: string): Promise<ThinkingSession[]> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to fetch sessions');
    }

    const { data, error } = await this.client
      .from('thinking_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Supabase query error in getSessions:', error.message);
      throw new Error(`Failed to retrieve sessions: ${error.message}`);
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: row.user_id as string,
      title: row.title as string,
      problemStatement: row.problem_statement as string,
      currentMode: row.current_mode as ThinkingMode,
      currentStage: (row.current_stage as CoThinkerStep) || 'welcome',
      status: row.status as 'active' | 'archived',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  /**
   * Retrieves a single session after strictly verifying the caller's ownership.
   */
  async getSession(id: string, userId: string): Promise<ThinkingSession | null> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to access session');
    }

    const { data, error } = await this.client
      .from('thinking_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error(`Failed to fetch session ${id}:`, error.message);
      throw new Error(`Database error retrieving session: ${error.message}`);
    }
    if (!data) return null;

    // Strict ownership verification (prevent IDOR)
    if (data.user_id !== userId) {
      throw new Error('Unauthorized session access: ownership verification failed');
    }

    return {
      id: data.id,
      userId: data.user_id,
      title: data.title,
      problemStatement: data.problem_statement,
      currentMode: data.current_mode,
      currentStage: (data.current_stage as CoThinkerStep) || 'welcome',
      status: data.status,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Creates a new session bound to the authenticated user.
   */
  async createSession(session: ThinkingSession, userId: string): Promise<ThinkingSession> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to create session');
    }

    const payload = {
      id: session.id && session.id.includes('-') && session.id.length === 36 ? session.id : undefined,
      title: session.title,
      problem_statement: session.problemStatement,
      current_mode: session.currentMode,
      current_stage: session.currentStage || 'welcome',
      status: session.status,
      user_id: userId,
      created_at: session.createdAt || new Date().toISOString(),
      updated_at: session.updatedAt || new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('thinking_sessions')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('Failed to create session in Supabase:', error.message);
      throw new Error(`Failed to persist new session: ${error.message}`);
    }

    return {
      ...session,
      id: data.id,
      userId: data.user_id,
      currentStage: (data.current_stage as CoThinkerStep) || 'welcome',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Updates an existing session after verifying ownership.
   * Explicitly persists problemStatement and currentStage.
   */
  async updateSession(
    id: string,
    updates: Partial<ThinkingSession>,
    userId: string
  ): Promise<ThinkingSession> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to update session');
    }

    // Verify ownership first
    const existing = await this.getSession(id, userId);
    if (!existing) {
      throw new Error('Session not found or unauthorized');
    }

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.problemStatement !== undefined) payload.problem_statement = updates.problemStatement;
    if (updates.currentMode !== undefined) payload.current_mode = updates.currentMode;
    if (updates.currentStage !== undefined) payload.current_stage = updates.currentStage;
    if (updates.status !== undefined) payload.status = updates.status;

    const { data, error } = await this.client
      .from('thinking_sessions')
      .update(payload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Failed to update session:', error.message);
      throw new Error(`Failed to persist session updates: ${error.message}`);
    }

    return {
      id: data.id,
      userId: data.user_id,
      title: data.title,
      problemStatement: data.problem_statement,
      currentMode: data.current_mode,
      currentStage: (data.current_stage as CoThinkerStep) || 'welcome',
      status: data.status,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Records a complete workflow step atomically with transactional database execution.
   * Leverages PostgreSQL RPC `record_workflow_step_tx` with:
   *   - Row-level FOR UPDATE locking for serialized transitions
   *   - Optimistic concurrency control via expectedStage/expectedMode comparison
   *   - Post-lock idempotency check to prevent TOCTOU races
   *   - Payload consistency enforcement on idempotency keys
   *
   * In production, fails closed if the transactional RPC is unavailable.
   * The non-transactional compensating fallback is restricted to explicitly
   * non-production environments (test doubles, local development).
   */
  async recordWorkflowStep(
    params: RecordWorkflowStepParams,
    userId: string
  ): Promise<RecordWorkflowStepResult> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to record workflow step');
    }

    const cacheKey = params.clientRequestId ? `${userId}:${params.sessionId}:${params.clientRequestId}` : null;
    const requestHash = params.requestHash || (params.clientRequestId ? computeRequestHash(params) : null);

    if (cacheKey && requestHash) {
      const cached = SupabaseThinkingRepository.idempotencyCache.get(cacheKey);
      if (cached) {
        if (cached.requestHash !== requestHash) {
          throw new Error(
            `Idempotency key reuse violation: clientRequestId "${params.clientRequestId}" was previously used with different payload`
          );
        }
        return {
          ...cached.result,
          isIdempotentReplay: true,
        };
      }
    }

    // 1. Attempt true PostgreSQL atomic transaction via RPC
    if (this.client && typeof (this.client as unknown as Record<string, unknown>).rpc === 'function') {
      const { data: rpcData, error: rpcError } = await this.client.rpc(
        'record_workflow_step_tx',
        {
          p_session_id: params.sessionId,
          p_user_id: userId,
          p_user_message: params.userMessage?.trim() || null,
          p_assistant_message: params.assistantMessage,
          p_next_stage: params.nextStage,
          p_next_mode: params.nextMode,
          p_expected_stage: params.expectedStage,
          p_expected_mode: params.expectedMode,
          p_problem_statement: params.problemStatement || null,
          p_suggested_questions: params.suggestedQuestions || [],
          p_client_request_id: params.clientRequestId || null,
          p_request_hash: requestHash,
          p_client_response: params.clientResponse || null,
        }
      );

      if (rpcError) {
        // Map CONFLICT exceptions from RPC to a structured conflict result
        if (rpcError.message && rpcError.message.includes('CONFLICT:')) {
          const conflictResult: RecordWorkflowStepResult = {
            sessionId: params.sessionId,
            assistantMessageId: '',
            nextStage: params.nextStage,
            nextMode: params.nextMode,
            isConflict: true,
          };
          return conflictResult;
        }
        if (
          rpcError.message &&
          (rpcError.message.includes('Forbidden') ||
            rpcError.message.includes('Unauthorized') ||
            rpcError.message.includes('not found'))
        ) {
          throw new Error('Session not found or unauthorized');
        }
        // Re-throw all other RPC errors (auth failures, constraint violations, etc.)
        throw new Error(`Workflow RPC failed: ${rpcError.message}`);
      }

      if (rpcData) {
        const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (row) {
          const res: RecordWorkflowStepResult = {
            sessionId: row.sessionId || row.session_id || params.sessionId,
            userMessageId: row.userMessageId || row.user_message_id,
            assistantMessageId: row.assistantMessageId || row.assistant_message_id,
            nextStage: row.nextStage || row.next_stage || params.nextStage,
            nextMode: row.nextMode || row.next_mode || params.nextMode,
            message: row.message || params.assistantMessage,
            nextStep: row.nextStep || row.nextStage || params.nextStage,
            options: row.options || (params.suggestedQuestions ? params.suggestedQuestions.map((q: string, idx: number) => ({ id: `opt-${idx}`, label: q })) : []),
            progressPercent: row.progressPercent,
            executionMode: row.executionMode,
            modelName: row.modelName,
            simulatedNotice: row.simulatedNotice,
            isIdempotentReplay: Boolean(row.isIdempotentReplay),
            clientResponse: row.clientResponse || (row.message ? (row as Record<string, unknown>) : undefined),
          };
          if (cacheKey && requestHash) {
            SupabaseThinkingRepository.idempotencyCache.set(cacheKey, {
              result: res,
              requestHash,
            });
          }
          return res;
        }
      }

      // RPC returned no data and no error — treat as unexpected failure
      throw new Error('Workflow RPC returned empty result');
    }

    // 2. Production fail-closed: refuse to use non-transactional fallback
    if (isProductionRuntime()) {
      throw new Error(
        'FATAL: Transactional RPC record_workflow_step_tx is not available. ' +
        'Non-transactional fallback is disabled in production to prevent partial state corruption. ' +
        'Ensure the migration has been applied and the RPC is executable by service_role.'
      );
    }

    // 3. Non-production fallback: compensating writes for test environments only
    console.warn(
      '[WARN] Using non-transactional compensating fallback for recordWorkflowStep. ' +
      'This path is disabled in production (NODE_ENV=production or FAIL_CLOSED_WORKFLOW=true).'
    );

    const session = await this.getSession(params.sessionId, userId);
    if (!session) {
      throw new Error('Session not found or unauthorized');
    }

    // Concurrency check in fallback path (best-effort, not serialized)
    if (params.expectedStage && session.currentStage !== params.expectedStage) {
      return {
        sessionId: params.sessionId,
        assistantMessageId: '',
        nextStage: params.nextStage,
        nextMode: params.nextMode,
        isConflict: true,
      };
    }

    // Accepted Decision Gate: Moving to Act mode or choose_action requires at least one accepted decision
    if (params.nextMode === 'act' || params.nextStage === 'choose_action') {
      const insights = await this.getInsights(params.sessionId, userId);
      const hasAccepted = insights.some((i) => i.category === 'decision' && i.status === 'accepted');
      if (!hasAccepted) {
        throw new Error('Transition denied: Moving to Act mode or choose_action requires at least one accepted decision insight');
      }
    }

    const createdMessageIds: string[] = [];

    try {
      let userMessageId: string | undefined = undefined;

      // Persist user message if provided
      if (params.userMessage && params.userMessage.trim()) {
        userMessageId = crypto.randomUUID();
        const { error: userErr } = await this.client.from('session_messages').insert({
          id: userMessageId,
          session_id: params.sessionId,
          role: 'user',
          content: params.userMessage.trim(),
          mode: session.currentMode,
          created_at: new Date().toISOString(),
        });

        if (userErr) {
          throw new Error(`Failed to record user message: ${userErr.message}`);
        }
        createdMessageIds.push(userMessageId);
      }

      // Persist assistant message
      const assistantMessageId = crypto.randomUUID();
      const { error: astErr } = await this.client.from('session_messages').insert({
        id: assistantMessageId,
        session_id: params.sessionId,
        role: 'assistant',
        content: params.assistantMessage,
        mode: params.nextMode,
        suggested_questions: params.suggestedQuestions || [],
        created_at: new Date().toISOString(),
      });

      if (astErr) {
        throw new Error(`Failed to record assistant message: ${astErr.message}`);
      }
      createdMessageIds.push(assistantMessageId);

      // Update session stage, mode, and problemStatement
      const sessionUpdate: Record<string, unknown> = {
        current_mode: params.nextMode,
        current_stage: params.nextStage,
        updated_at: new Date().toISOString(),
      };
      if (params.problemStatement !== undefined) {
        sessionUpdate.problem_statement = params.problemStatement;
      }

      const { error: updateErr } = await this.client
        .from('thinking_sessions')
        .update(sessionUpdate)
        .eq('id', params.sessionId)
        .eq('user_id', userId);

      if (updateErr) {
        throw new Error(`Failed to commit workflow state: ${updateErr.message}`);
      }

      const result: RecordWorkflowStepResult = {
        sessionId: params.sessionId,
        userMessageId,
        assistantMessageId,
        nextStage: params.nextStage,
        nextMode: params.nextMode,
        message: params.assistantMessage,
        nextStep: params.nextStage,
        options: (params.clientResponse?.options as ChoiceOption[]) || params.suggestedQuestions?.map((q, idx) => ({ id: `opt-${idx}`, label: q })),
        progressPercent: (params.clientResponse?.progressPercent as number) || 0,
        executionMode: (params.clientResponse?.executionMode as 'gemini' | 'simulator' | 'error') || 'gemini',
        isIdempotentReplay: false,
        clientResponse: params.clientResponse,
      };

      if (cacheKey && requestHash) {
        SupabaseThinkingRepository.idempotencyCache.set(cacheKey, {
          result,
          requestHash,
        });
      }

      return result;
    } catch (workflowErr) {
      // Compensate: Delete any inserted messages to prevent corrupting conversation history
      for (const msgId of createdMessageIds) {
        try {
          await this.client.from('session_messages').delete().eq('id', msgId);
        } catch (cleanupErr) {
          console.error(`Failed to compensate message ${msgId}:`, cleanupErr);
        }
      }
      throw workflowErr;
    }
  }

  /**
   * Performs an atomic workflow mode transition using row locking in PostgreSQL.
   * Compares expectedMode under the lock, validates prerequisite decisions,
   * updates the session atomically, and records the transition audit log.
   */
  async transitionMode(
    params: TransitionModeParams,
    userId: string
  ): Promise<TransitionModeResult> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to transition mode');
    }

    if (this.client && typeof (this.client as unknown as Record<string, unknown>).rpc === 'function') {
      const { data: rpcData, error: rpcError } = await this.client.rpc(
        'transition_workflow_mode_tx',
        {
          p_session_id: params.sessionId,
          p_user_id: userId,
          p_expected_mode: params.expectedMode,
          p_to_mode: params.toMode,
          p_reason: params.reason || null,
        }
      );

      if (rpcError) {
        if (rpcError.message && rpcError.message.includes('CONFLICT:')) {
          return {
            sessionId: params.sessionId,
            fromMode: params.expectedMode,
            toMode: params.toMode,
            stage: 'describe_problem',
            allowed: false,
            isConflict: true,
          };
        }
        if (
          rpcError.message &&
          (rpcError.message.includes('Forbidden') ||
            rpcError.message.includes('Unauthorized') ||
            rpcError.message.includes('not found'))
        ) {
          throw new Error('Session not found or unauthorized');
        }
        if (rpcError.message && rpcError.message.includes('denied')) {
          return {
            sessionId: params.sessionId,
            fromMode: params.expectedMode,
            toMode: params.toMode,
            stage: 'describe_problem',
            allowed: false,
          };
        }
        throw new Error(`Workflow transition RPC failed: ${rpcError.message}`);
      }

      if (rpcData) {
        const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        return {
          sessionId: row.sessionId || params.sessionId,
          fromMode: (row.fromMode as ThinkingMode) || params.expectedMode,
          toMode: (row.toMode as ThinkingMode) || params.toMode,
          stage: (row.stage as CoThinkerStep) || 'describe_problem',
          allowed: true,
        };
      }

      throw new Error('Workflow transition RPC returned empty result');
    }

    // Fail closed in production if transactional RPC is not available
    if (isProductionRuntime()) {
      throw new Error(
        'FATAL: Transactional RPC transition_workflow_mode_tx is not available. Non-transactional fallback disabled in production.'
      );
    }

    // Non-production test fallback
    const session = await this.getSession(params.sessionId, userId);
    if (!session) {
      throw new Error('Session not found or unauthorized');
    }

    if (session.currentMode !== params.expectedMode) {
      return {
        sessionId: params.sessionId,
        fromMode: params.expectedMode,
        toMode: params.toMode,
        stage: session.currentStage || 'describe_problem',
        allowed: false,
        isConflict: true,
      };
    }

    // Validate decisions when transitioning to 'act'
    if (params.toMode === 'act') {
      const insights = await this.getInsights(params.sessionId, userId);
      const hasAccepted = insights.some((i) => i.category === 'decision' && i.status === 'accepted');
      if (!hasAccepted) {
        return {
          sessionId: params.sessionId,
          fromMode: params.expectedMode,
          toMode: params.toMode,
          stage: session.currentStage || 'describe_problem',
          allowed: false,
        };
      }
    }

    const defaultStage: CoThinkerStep =
      params.toMode === 'understand' ? 'describe_problem' :
      params.toMode === 'explore' ? 'explore_perspectives' :
      params.toMode === 'challenge' ? 'challenge_assumptions' :
      params.toMode === 'decide' ? 'summarize_insights' : 'choose_action';

    await this.updateSession(
      params.sessionId,
      {
        currentMode: params.toMode,
        currentStage: defaultStage,
      },
      userId
    );

    return {
      sessionId: params.sessionId,
      fromMode: params.expectedMode,
      toMode: params.toMode,
      stage: defaultStage,
      allowed: true,
    };
  }

  /**
   * Deletes all thinking sessions, messages, and insights owned by the user.
   */
  async deleteAllUserSessions(userId: string): Promise<number> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to delete all sessions');
    }

    const { data: sessions, error: fetchErr } = await this.client
      .from('thinking_sessions')
      .select('id')
      .eq('user_id', userId);

    if (fetchErr) {
      throw new Error(`Failed to list user sessions: ${fetchErr.message}`);
    }

    const count = (sessions || []).length;
    if (count === 0) return 0;

    const { error: delErr } = await this.client
      .from('thinking_sessions')
      .delete()
      .eq('user_id', userId);

    if (delErr) {
      throw new Error(`Failed to delete user sessions: ${delErr.message}`);
    }

    return count;
  }

  /**
   * Deletes a session atomically scoped to the verified owner.
   */
  async deleteSession(id: string, userId: string): Promise<void> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to delete session');
    }

    // Verify ownership before deleting
    const existing = await this.getSession(id, userId);
    if (!existing) {
      throw new Error('Session not found or unauthorized');
    }

    const { error } = await this.client
      .from('thinking_sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to delete session:', error.message);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

  /**
   * Retrieves messages for an authorized session.
   */
  async getMessages(sessionId: string, userId: string): Promise<SessionMessage[]> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to get messages');
    }

    // Verify session belongs to user
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      throw new Error('Session not found or unauthorized');
    }

    const { data, error } = await this.client
      .from('session_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to get session messages:', error.message);
      throw new Error(`Failed to fetch messages: ${error.message}`);
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content as string,
      mode: row.mode as ThinkingMode,
      suggestedQuestions: row.suggested_questions as string[] | undefined,
      createdAt: row.created_at as string,
    }));
  }

  /**
   * Adds a message to an authorized session.
   */
  async addMessage(message: SessionMessage, userId: string): Promise<SessionMessage> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to add message');
    }

    const session = await this.getSession(message.sessionId, userId);
    if (!session) {
      throw new Error('Session not found or unauthorized');
    }

    const payload = {
      session_id: message.sessionId,
      role: message.role,
      content: message.content,
      mode: message.mode,
      suggested_questions: message.suggestedQuestions || [],
      created_at: message.createdAt || new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('session_messages')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('Failed to insert message into Supabase:', error.message);
      throw new Error(`Failed to persist session message: ${error.message}`);
    }

    return {
      ...message,
      id: data.id,
    };
  }

  /**
   * Retrieves insights for an authorized session.
   */
  async getInsights(sessionId: string, userId: string): Promise<Insight[]> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to get insights');
    }

    const session = await this.getSession(sessionId, userId);
    if (!session) {
      throw new Error('Session not found or unauthorized');
    }

    const { data, error } = await this.client
      .from('session_insights')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to get session insights:', error.message);
      throw new Error(`Failed to fetch insights: ${error.message}`);
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      category: row.category as InsightCategory,
      title: row.title as string,
      content: row.content as string,
      status: row.status as InsightStatus,
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  /**
   * Upserts an insight strictly scoped to the user's session.
   * If an existing insight ID is provided, strictly validates that the existing record
   * belongs to a session owned by the caller before applying any updates.
   */
  async upsertInsight(insight: Insight, userId: string): Promise<Insight> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to upsert insight');
    }

    // 1. Verify caller owns the destination session
    const targetSession = await this.getSession(insight.sessionId, userId);
    if (!targetSession) {
      throw new Error('Target session not found or unauthorized');
    }

    // 2. If an existing ID is supplied, check whether it already exists in the database
    if (insight.id && insight.id.includes('-') && insight.id.length === 36) {
      const { data: existing, error: checkErr } = await this.client
        .from('session_insights')
        .select('id, session_id')
        .eq('id', insight.id)
        .maybeSingle();

      if (checkErr) {
        throw new Error(`Database error verifying existing insight: ${checkErr.message}`);
      }

      if (existing) {
        // Cross-session / cross-user IDOR protection:
        // Ensure existing insight belongs to the caller's target session
        if (existing.session_id !== insight.sessionId) {
          throw new Error('Security violation: Cannot reassign insight belonging to another session');
        }

        const existingSession = await this.getSession(existing.session_id, userId);
        if (!existingSession) {
          throw new Error('Security violation: Cannot overwrite insight belonging to another user');
        }

        const category = normalizeInsightCategory(insight.category);
        const status = normalizeInsightStatus(insight.status);

        // Perform explicit safe update
        const { data, error } = await this.client
          .from('session_insights')
          .update({
            category,
            title: insight.title,
            content: insight.content,
            status,
            metadata: insight.metadata || {},
            updated_at: new Date().toISOString(),
          })
          .eq('id', insight.id)
          .eq('session_id', insight.sessionId)
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to update insight: ${error.message}`);
        }

        return {
          ...insight,
          category,
          status,
          id: data.id,
        };
      }
    }

    const category = normalizeInsightCategory(insight.category);
    const status = normalizeInsightStatus(insight.status);

    // 3. New insight insert
    const insertPayload = {
      id: (insight.id && insight.id.includes('-') && insight.id.length === 36) ? insight.id : undefined,
      session_id: insight.sessionId,
      category,
      title: insight.title,
      content: insight.content,
      status,
      metadata: insight.metadata || {},
      created_at: insight.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('session_insights')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error('Failed to create insight:', error.message);
      throw new Error(`Failed to save insight: ${error.message}`);
    }

    return {
      ...insight,
      id: data.id,
    };
  }

  /**
   * Deletes an insight after verifying that its parent session belongs to the caller.
   */
  async deleteInsight(id: string, userId: string): Promise<void> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to delete insight');
    }

    // Find the insight to check its session ownership
    const { data: item, error: fetchErr } = await this.client
      .from('session_insights')
      .select('session_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !item) {
      throw new Error('Insight not found or unauthorized');
    }

    const session = await this.getSession(item.session_id, userId);
    if (!session) {
      throw new Error('Insight not found or unauthorized');
    }

    const { error } = await this.client
      .from('session_insights')
      .delete()
      .eq('id', id)
      .eq('session_id', item.session_id);
    if (error) {
      console.error('Failed to delete insight:', error.message);
      throw new Error(`Failed to delete insight: ${error.message}`);
    }
  }
}
