import { SupabaseClient } from '@supabase/supabase-js';
import { ThinkingSession, SessionMessage, Insight, ThinkingMode, InsightCategory, InsightStatus } from '@/types';
import { getServiceSupabaseClient } from './supabase-client';

export interface ThinkingRepository {
  getSessions(userId?: string): Promise<ThinkingSession[]>;
  getSession(id: string, userId?: string): Promise<ThinkingSession | null>;
  createSession(session: ThinkingSession): Promise<ThinkingSession>;
  updateSession(id: string, updates: Partial<ThinkingSession>, userId?: string): Promise<ThinkingSession>;
  deleteSession(id: string, userId?: string): Promise<void>;
  getMessages(sessionId: string, userId?: string): Promise<SessionMessage[]>;
  addMessage(message: SessionMessage, userId?: string): Promise<SessionMessage>;
  getInsights(sessionId: string, userId?: string): Promise<Insight[]>;
  upsertInsight(insight: Insight, userId?: string): Promise<Insight>;
  deleteInsight(id: string, userId?: string): Promise<void>;
}

export class SupabaseThinkingRepository implements ThinkingRepository {
  private client: SupabaseClient;

  constructor(customClient?: SupabaseClient) {
    this.client = customClient || getServiceSupabaseClient();
  }

  async getSessions(userId?: string): Promise<ThinkingSession[]> {
    let query = this.client
      .from('thinking_sessions')
      .select('*')
      .order('updated_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Supabase query error in getSessions:', error.message);
      throw new Error(`Failed to retrieve sessions: ${error.message}`);
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: (row.user_id as string) || 'anonymous',
      title: row.title as string,
      problemStatement: row.problem_statement as string,
      currentMode: row.current_mode as ThinkingMode,
      status: row.status as 'active' | 'archived',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async getSession(id: string, userId?: string): Promise<ThinkingSession | null> {
    const query = this.client.from('thinking_sessions').select('*').eq('id', id).maybeSingle();

    const { data, error } = await query;
    if (error) {
      console.error(`Failed to fetch session ${id}:`, error.message);
      throw new Error(`Database error retrieving session: ${error.message}`);
    }
    if (!data) return null;

    // Strict ownership verification (prevent IDOR)
    if (userId && data.user_id && data.user_id !== userId) {
      throw new Error('Unauthorized session access: ownership verification failed');
    }

    return {
      id: data.id,
      userId: data.user_id || 'anonymous',
      title: data.title,
      problemStatement: data.problem_statement,
      currentMode: data.current_mode,
      status: data.status,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async createSession(session: ThinkingSession): Promise<ThinkingSession> {
    const payload = {
      id: session.id.includes('-') && session.id.length === 36 ? session.id : undefined,
      title: session.title,
      problem_statement: session.problemStatement,
      current_mode: session.currentMode,
      status: session.status,
      user_id: session.userId && session.userId.length === 36 ? session.userId : null,
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
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async updateSession(
    id: string,
    updates: Partial<ThinkingSession>,
    userId?: string
  ): Promise<ThinkingSession> {
    // Validate ownership before updating
    if (userId) {
      const existing = await this.getSession(id, userId);
      if (!existing) {
        throw new Error('Session not found or unauthorized');
      }
    }

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title) payload.title = updates.title;
    if (updates.currentMode) payload.current_mode = updates.currentMode;
    if (updates.status) payload.status = updates.status;

    let query = this.client
      .from('thinking_sessions')
      .update(payload)
      .eq('id', id);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.select().single();

    if (error) {
      console.error('Failed to update session:', error.message);
      throw new Error(`Failed to update session: ${error.message}`);
    }

    return {
      id: data.id,
      userId: data.user_id || 'anonymous',
      title: data.title,
      problemStatement: data.problem_statement,
      currentMode: data.current_mode,
      status: data.status,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async deleteSession(id: string, userId?: string): Promise<void> {
    if (userId) {
      const session = await this.getSession(id, userId);
      if (!session) {
        throw new Error('Session not found or unauthorized');
      }
    }

    let query = this.client.from('thinking_sessions').delete().eq('id', id);
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { error } = await query;
    if (error) {
      console.error('Failed to delete session:', error.message);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

  async getMessages(sessionId: string, userId?: string): Promise<SessionMessage[]> {
    if (userId) {
      const session = await this.getSession(sessionId, userId);
      if (!session) {
        throw new Error('Session not found or unauthorized');
      }
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

  async addMessage(message: SessionMessage, userId?: string): Promise<SessionMessage> {
    if (userId) {
      const session = await this.getSession(message.sessionId, userId);
      if (!session) {
        throw new Error('Session not found or unauthorized');
      }
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

  async getInsights(sessionId: string, userId?: string): Promise<Insight[]> {
    if (userId) {
      const session = await this.getSession(sessionId, userId);
      if (!session) {
        throw new Error('Session not found or unauthorized');
      }
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

  async upsertInsight(insight: Insight, userId?: string): Promise<Insight> {
    if (userId) {
      const session = await this.getSession(insight.sessionId, userId);
      if (!session) {
        throw new Error('Session not found or unauthorized');
      }
    }

    const payload = {
      id: insight.id.includes('-') && insight.id.length === 36 ? insight.id : undefined,
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
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('Failed to upsert insight:', error.message);
      throw new Error(`Failed to save insight: ${error.message}`);
    }

    return {
      ...insight,
      id: data.id,
    };
  }

  async deleteInsight(id: string, userId?: string): Promise<void> {
    if (userId) {
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
    }

    const { error } = await this.client.from('session_insights').delete().eq('id', id);
    if (error) {
      console.error('Failed to delete insight:', error.message);
      throw new Error(`Failed to delete insight: ${error.message}`);
    }
  }
}
