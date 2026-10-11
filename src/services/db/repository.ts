import { ThinkingSession, SessionMessage, Insight } from '@/types';
import { getServiceSupabaseClient } from './supabase-client';

export interface ThinkingRepository {
  getSessions(userId?: string): Promise<ThinkingSession[]>;
  getSession(id: string, userId?: string): Promise<ThinkingSession | null>;
  createSession(session: ThinkingSession): Promise<ThinkingSession>;
  updateSession(id: string, updates: Partial<ThinkingSession>, userId?: string): Promise<ThinkingSession>;
  deleteSession(id: string, userId?: string): Promise<void>;
  getMessages(sessionId: string): Promise<SessionMessage[]>;
  addMessage(message: SessionMessage): Promise<SessionMessage>;
  getInsights(sessionId: string): Promise<Insight[]>;
  upsertInsight(insight: Insight): Promise<Insight>;
  deleteInsight(id: string): Promise<void>;
}

export class SupabaseThinkingRepository implements ThinkingRepository {
  private client = getServiceSupabaseClient();

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
      console.warn('Supabase query error, falling back:', error.message);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id || 'anonymous',
      title: row.title,
      problemStatement: row.problem_statement,
      currentMode: row.current_mode,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getSession(id: string, userId?: string): Promise<ThinkingSession | null> {
    let query = this.client.from('thinking_sessions').select('*').eq('id', id).maybeSingle();

    const { data, error } = await query;
    if (error || !data) return null;

    // Ownership check (prevent IDOR)
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
      return session;
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

    const payload: any = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title) payload.title = updates.title;
    if (updates.currentMode) payload.current_mode = updates.currentMode;
    if (updates.status) payload.status = updates.status;

    const { data, error } = await this.client
      .from('thinking_sessions')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Failed to update session:', error.message);
      return { id, ...updates } as ThinkingSession;
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
      await this.getSession(id, userId); // verify ownership first
    }

    const { error } = await this.client.from('thinking_sessions').delete().eq('id', id);
    if (error) {
      console.error('Failed to delete session:', error.message);
    }
  }

  async getMessages(sessionId: string): Promise<SessionMessage[]> {
    const { data, error } = await this.client
      .from('session_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) return [];

    return (data || []).map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      mode: row.mode,
      suggestedQuestions: row.suggested_questions,
      createdAt: row.created_at,
    }));
  }

  async addMessage(message: SessionMessage): Promise<SessionMessage> {
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
      console.warn('Failed to insert message into Supabase:', error.message);
      return message;
    }

    return {
      ...message,
      id: data.id,
    };
  }

  async getInsights(sessionId: string): Promise<Insight[]> {
    const { data, error } = await this.client
      .from('session_insights')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) return [];

    return (data || []).map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      category: row.category,
      title: row.title,
      content: row.content,
      status: row.status,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async upsertInsight(insight: Insight): Promise<Insight> {
    const payload = {
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
      .upsert(payload)
      .select()
      .single();

    if (error) {
      return insight;
    }

    return {
      ...insight,
      id: data.id,
    };
  }

  async deleteInsight(id: string): Promise<void> {
    await this.client.from('session_insights').delete().eq('id', id);
  }
}
