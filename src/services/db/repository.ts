import { SupabaseClient } from '@supabase/supabase-js';
import { ThinkingSession, SessionMessage, Insight, ThinkingMode, CoThinkerStep, InsightCategory, InsightStatus } from '@/types';
import { getServiceSupabaseClient } from './supabase-client';

export interface RecordWorkflowStepParams {
  sessionId: string;
  userMessage?: string;
  assistantMessage: string;
  nextStage: CoThinkerStep;
  nextMode: ThinkingMode;
  problemStatement?: string;
  suggestedQuestions?: string[];
  clientRequestId?: string;
}

export interface RecordWorkflowStepResult {
  sessionId: string;
  userMessageId?: string;
  assistantMessageId: string;
  nextStage: CoThinkerStep;
  nextMode: ThinkingMode;
}

export interface ThinkingRepository {
  getSessions(userId: string): Promise<ThinkingSession[]>;
  getSession(id: string, userId: string): Promise<ThinkingSession | null>;
  createSession(session: ThinkingSession, userId: string): Promise<ThinkingSession>;
  updateSession(id: string, updates: Partial<ThinkingSession>, userId: string): Promise<ThinkingSession>;
  recordWorkflowStep(params: RecordWorkflowStepParams, userId: string): Promise<RecordWorkflowStepResult>;
  deleteSession(id: string, userId: string): Promise<void>;
  getMessages(sessionId: string, userId: string): Promise<SessionMessage[]>;
  addMessage(message: SessionMessage, userId: string): Promise<SessionMessage>;
  getInsights(sessionId: string, userId: string): Promise<Insight[]>;
  upsertInsight(insight: Insight, userId: string): Promise<Insight>;
  deleteInsight(id: string, userId: string): Promise<void>;
}

export class SupabaseThinkingRepository implements ThinkingRepository {
  private client: SupabaseClient;

  constructor(customClient?: SupabaseClient) {
    this.client = customClient || getServiceSupabaseClient();
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
   * Records a complete workflow step atomically with transactional compensation.
   * Ensures user message, assistant message, and session stage/mode update are committed together.
   * If any step fails, rolls back newly inserted messages so partial conversation history is never left.
   */
  async recordWorkflowStep(
    params: RecordWorkflowStepParams,
    userId: string
  ): Promise<RecordWorkflowStepResult> {
    if (!userId) {
      throw new Error('Mandatory authorization failure: userId is required to record workflow step');
    }

    // 1. Verify caller owns the session
    const session = await this.getSession(params.sessionId, userId);
    if (!session) {
      throw new Error('Session not found or unauthorized');
    }

    const createdMessageIds: string[] = [];

    try {
      let userMessageId: string | undefined = undefined;

      // 2. Persist user message if provided
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

      // 3. Persist assistant message
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

      // 4. Update session stage, mode, and problemStatement
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

      return {
        sessionId: params.sessionId,
        userMessageId,
        assistantMessageId,
        nextStage: params.nextStage,
        nextMode: params.nextMode,
      };
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

        // Perform explicit safe update
        const { data, error } = await this.client
          .from('session_insights')
          .update({
            category: insight.category,
            title: insight.title,
            content: insight.content,
            status: insight.status,
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
          id: data.id,
        };
      }
    }

    // 3. New insight insert
    const insertPayload = {
      id: (insight.id && insight.id.includes('-') && insight.id.length === 36) ? insight.id : undefined,
      session_id: insight.sessionId,
      category: insight.category,
      title: insight.title,
      content: insight.content,
      status: insight.status,
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

    const { error } = await this.client.from('session_insights').delete().eq('id', id);
    if (error) {
      console.error('Failed to delete insight:', error.message);
      throw new Error(`Failed to delete insight: ${error.message}`);
    }
  }
}
