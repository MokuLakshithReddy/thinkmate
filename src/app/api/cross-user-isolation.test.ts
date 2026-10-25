import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { GET as getSessions, POST as postSessions, DELETE as deleteSessions } from '@/app/api/sessions/route';
import { POST as postInsights, DELETE as deleteInsights } from '@/app/api/insights/route';
import { POST as postCoThink } from '@/app/api/cothink/route';
import { POST as postTransition } from '@/app/api/workflow/transition/route';
import { supabase } from '@/services/db/supabase-client';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { ThinkingSession, Insight, SessionMessage, CoThinkerStep, ThinkingMode } from '@/types';

/**
 * Application-Level End-to-End Cross-User Isolation Suite
 * 
 * Exercises genuine HTTP route handlers with two distinct authenticated identities:
 *   - User A (Alice): 'usr_alice_11111111_1111_1111_1111_111111111111'
 *   - User B (Bob):   'usr_bob_22222222_2222_2222_2222_222222222222'
 *
 * Verifies that User B cannot read, list, delete, inject messages into, or mutate
 * User A's sessions, insights, or workflow stages.
 */
describe('Application-Level Cross-User Isolation & Anti-IDOR Protections', () => {
  const ALICE_ID = 'usr_alice_11111111_1111_1111_1111_111111111111';
  const ALICE_TOKEN = 'token-alice-secret';
  const BOB_ID = 'usr_bob_22222222_2222_2222_2222_222222222222';
  const BOB_TOKEN = 'token-bob-secret';

  // In-memory data store simulating the database with strict tenant separation
  const database = {
    sessions: new Map<string, ThinkingSession & { userId: string }>(),
    insights: new Map<string, { id: string; sessionId: string; userId: string; title: string; content: string; category: string; status: string }>(),
    messages: new Map<string, { id: string; sessionId: string; userId: string; role: string; content: string }>(),
  };

  const origEnvServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origEnvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origEnvAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const origNodeEnv = process.env.NODE_ENV;

  const origGetUser = supabase.auth.getUser;
  const origGetSession = SupabaseThinkingRepository.prototype.getSession;
  const origGetSessions = SupabaseThinkingRepository.prototype.getSessions;
  const origCreateSession = SupabaseThinkingRepository.prototype.createSession;
  const origDeleteSession = SupabaseThinkingRepository.prototype.deleteSession;
  const origGetInsights = SupabaseThinkingRepository.prototype.getInsights;
  const origUpsertInsight = SupabaseThinkingRepository.prototype.upsertInsight;
  const origDeleteInsight = SupabaseThinkingRepository.prototype.deleteInsight;
  const origGetMessages = SupabaseThinkingRepository.prototype.getMessages;
  const origRecordWorkflowStep = SupabaseThinkingRepository.prototype.recordWorkflowStep;
  const origTransitionMode = SupabaseThinkingRepository.prototype.transitionMode;

  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-test-test-test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key-test-test-test';

    database.sessions.clear();
    database.insights.clear();
    database.messages.clear();

    // 1. Mock token verification mapping tokens to distinct user IDs
    supabase.auth.getUser = (async (token?: string) => {
      if (token === ALICE_TOKEN) {
        return { data: { user: { id: ALICE_ID, email: 'alice@thinkmate.dev' } }, error: null };
      }
      if (token === BOB_TOKEN) {
        return { data: { user: { id: BOB_ID, email: 'bob@thinkmate.dev' } }, error: null };
      }
      return { data: { user: null }, error: { message: 'Invalid token', name: 'AuthApiError', status: 401 } };
    }) as unknown as typeof supabase.auth.getUser;

    // 2. Wire repository methods with strict multi-tenant isolation
    SupabaseThinkingRepository.prototype.createSession = async function (session, userId) {
      assert.ok(userId, 'Repository createSession requires authenticated userId');
      const record = { ...session, userId };
      database.sessions.set(session.id, record);
      return session;
    };

    SupabaseThinkingRepository.prototype.getSession = async function (id, userId) {
      assert.ok(userId, 'Repository getSession requires authenticated userId');
      const session = database.sessions.get(id);
      if (!session || session.userId !== userId) {
        return null;
      }
      return session;
    };

    SupabaseThinkingRepository.prototype.getSessions = async function (userId) {
      assert.ok(userId, 'Repository getSessions requires authenticated userId');
      return Array.from(database.sessions.values()).filter((s) => s.userId === userId);
    };

    SupabaseThinkingRepository.prototype.deleteSession = async function (id, userId) {
      assert.ok(userId, 'Repository deleteSession requires authenticated userId');
      const session = database.sessions.get(id);
      if (!session || session.userId !== userId) {
        throw new Error('Unauthorized session operation: session belongs to another user or does not exist');
      }
      database.sessions.delete(id);
    };

    SupabaseThinkingRepository.prototype.getInsights = async function (sessionId, userId) {
      assert.ok(userId, 'Repository getInsights requires authenticated userId');
      const session = database.sessions.get(sessionId);
      if (!session || session.userId !== userId) {
        return [];
      }
      return Array.from(database.insights.values()).filter((i) => i.sessionId === sessionId && i.userId === userId) as unknown as Insight[];
    };

    SupabaseThinkingRepository.prototype.upsertInsight = async function (insight, userId) {
      assert.ok(userId, 'Repository upsertInsight requires authenticated userId');
      const session = database.sessions.get(insight.sessionId);
      if (!session || session.userId !== userId) {
        throw new Error('Unauthorized insight operation: session belongs to another user or does not exist');
      }
      const record = { ...insight, userId };
      database.insights.set(insight.id, record);
      return insight;
    };

    SupabaseThinkingRepository.prototype.deleteInsight = async function (id, userId) {
      assert.ok(userId, 'Repository deleteInsight requires authenticated userId');
      const insight = database.insights.get(id);
      if (!insight || insight.userId !== userId) {
        throw new Error('Unauthorized insight operation: insight belongs to another user or does not exist');
      }
      database.insights.delete(id);
    };

    SupabaseThinkingRepository.prototype.getMessages = async function (sessionId, userId) {
      assert.ok(userId, 'Repository getMessages requires authenticated userId');
      const session = database.sessions.get(sessionId);
      if (!session || session.userId !== userId) {
        return [];
      }
      return Array.from(database.messages.values()).filter((m) => m.sessionId === sessionId && m.userId === userId) as unknown as SessionMessage[];
    };

    SupabaseThinkingRepository.prototype.recordWorkflowStep = async function (params, userId) {
      assert.ok(userId, 'Repository recordWorkflowStep requires authenticated userId');
      const session = database.sessions.get(params.sessionId);
      if (!session || session.userId !== userId) {
        throw new Error('Unauthorized session transition attempt');
      }
      session.currentStage = params.nextStage as CoThinkerStep;
      session.currentMode = params.nextMode as ThinkingMode;
      return {
        sessionId: params.sessionId,
        assistantMessageId: 'asst-msg-1',
        nextStage: params.nextStage,
        nextMode: params.nextMode,
        persistedAt: new Date().toISOString(),
      };
    };

    SupabaseThinkingRepository.prototype.transitionMode = async function (params, userId) {
      assert.ok(userId, 'Repository transitionMode requires authenticated userId');
      const session = database.sessions.get(params.sessionId);
      if (!session || session.userId !== userId) {
        throw new Error('Unauthorized workflow mode transition');
      }
      session.currentMode = params.toMode;
      return {
        sessionId: params.sessionId,
        fromMode: params.expectedMode,
        toMode: params.toMode,
        stage: 'describe_problem',
        allowed: true,
      };
    };
  });

  afterEach(() => {
    if (origEnvServiceRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origEnvServiceRole;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (origEnvUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = origEnvUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (origEnvAnon !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origEnvAnon;
    else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (origNodeEnv !== undefined) (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
    else delete (process.env as Record<string, string | undefined>).NODE_ENV;

    supabase.auth.getUser = origGetUser;
    SupabaseThinkingRepository.prototype.getSession = origGetSession;
    SupabaseThinkingRepository.prototype.getSessions = origGetSessions;
    SupabaseThinkingRepository.prototype.createSession = origCreateSession;
    SupabaseThinkingRepository.prototype.deleteSession = origDeleteSession;
    SupabaseThinkingRepository.prototype.getInsights = origGetInsights;
    SupabaseThinkingRepository.prototype.upsertInsight = origUpsertInsight;
    SupabaseThinkingRepository.prototype.deleteInsight = origDeleteInsight;
    SupabaseThinkingRepository.prototype.getMessages = origGetMessages;
    SupabaseThinkingRepository.prototype.recordWorkflowStep = origRecordWorkflowStep;
    SupabaseThinkingRepository.prototype.transitionMode = origTransitionMode;
  });

  function createAuthRequest(
    url: string,
    method: string,
    token: string,
    body?: Record<string, unknown>
  ): NextRequest {
    return new NextRequest(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it('Session Isolation: User B cannot fetch or discover User A session via GET /api/sessions', async () => {
    // 1. Alice creates a session
    const aliceCreateReq = createAuthRequest('http://localhost:3000/api/sessions', 'POST', ALICE_TOKEN, {
      title: 'Alice Secret Project Architecture',
      problemStatement: 'Proprietary IP details for vendor selection',
      currentMode: 'understand',
    });
    const aliceCreateRes = await postSessions(aliceCreateReq);
    assert.strictEqual(aliceCreateRes.status, 200);
    const aliceSession = (await aliceCreateRes.json()).session;
    assert.ok(aliceSession?.id);

    // 2. User B (Bob) attempts to fetch Alice's session directly by ID
    const bobFetchReq = createAuthRequest(
      `http://localhost:3000/api/sessions?id=${aliceSession.id}`,
      'GET',
      BOB_TOKEN
    );
    const bobFetchRes = await getSessions(bobFetchReq);
    assert.strictEqual(bobFetchRes.status, 404, 'Direct session access by another user must return 404 Not Found');
    const bobFetchBody = await bobFetchRes.json();
    assert.strictEqual(bobFetchBody.error, 'Session not found or unauthorized');

    // 3. User B (Bob) lists his own sessions; Alice's session must not be present
    const bobListReq = createAuthRequest('http://localhost:3000/api/sessions', 'GET', BOB_TOKEN);
    const bobListRes = await getSessions(bobListReq);
    assert.strictEqual(bobListRes.status, 200);
    const bobListBody = await bobListRes.json();
    assert.strictEqual(bobListBody.sessions.length, 0, "User B's session list must be empty");
  });

  it('Deletion Protection: User B cannot delete User A session via DELETE /api/sessions', async () => {
    // Alice creates a session
    const aliceSessionId = '00000000-0000-0000-0000-111111111111';
    database.sessions.set(aliceSessionId, {
      id: aliceSessionId,
      userId: ALICE_ID,
      title: 'Alice Critical Session',
      problemStatement: 'Production deployment checklist',
      currentMode: 'understand',
      currentStage: 'describe_problem',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      insights: [],
    });

    // User B attempts to delete Alice's session
    const bobDeleteReq = createAuthRequest(
      `http://localhost:3000/api/sessions?id=${aliceSessionId}`,
      'DELETE',
      BOB_TOKEN
    );
    const bobDeleteRes = await deleteSessions(bobDeleteReq);
    assert.strictEqual(bobDeleteRes.status, 403, 'Deleting foreign session must return 403 Forbidden');

    // Verify Alice's session remains untouched
    assert.ok(database.sessions.has(aliceSessionId), "Alice's session must not be deleted by User B");
  });

  it('Insights Mutation Protection: User B cannot inject or delete insights in User A session', async () => {
    // 1. Setup Alice's session and an insight
    const aliceSessionId = '00000000-0000-0000-0000-111111111111';
    const aliceInsightId = '00000000-0000-0000-0000-ins111111111';
    database.sessions.set(aliceSessionId, {
      id: aliceSessionId,
      userId: ALICE_ID,
      title: 'Alice Strategic Decisions',
      problemStatement: 'Acquisition strategy',
      currentMode: 'understand',
      currentStage: 'describe_problem',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      insights: [],
    });
    database.insights.set(aliceInsightId, {
      id: aliceInsightId,
      sessionId: aliceSessionId,
      userId: ALICE_ID,
      category: 'decision',
      title: 'Alice Decision',
      content: 'Authorized content',
      status: 'accepted',
    });

    // 2. User B attempts to inject a malicious insight into Alice's session
    const bobPostInsightReq = createAuthRequest(
      'http://localhost:3000/api/insights',
      'POST',
      BOB_TOKEN,
      {
        sessionId: aliceSessionId,
        category: 'decision',
        title: 'Tampered Decision',
        content: 'Injected foreign recommendation',
        status: 'accepted',
      }
    );
    const bobPostInsightRes = await postInsights(bobPostInsightReq);
    assert.strictEqual(bobPostInsightRes.status, 403, 'Injecting insight into foreign session must return 403 Forbidden');

    // 3. User B attempts to delete Alice's insight
    const bobDeleteInsightReq = createAuthRequest(
      `http://localhost:3000/api/insights?id=${aliceInsightId}`,
      'DELETE',
      BOB_TOKEN
    );
    const bobDeleteInsightRes = await deleteInsights(bobDeleteInsightReq);
    assert.strictEqual(bobDeleteInsightRes.status, 403, 'Deleting foreign insight must return 403 Forbidden');
    assert.ok(database.insights.has(aliceInsightId), "Alice's insight must remain intact in database");
  });

  it('Co-Think Progression Isolation: User B cannot execute steps on User A session via /api/cothink', async () => {
    const aliceSessionId = '00000000-0000-0000-0000-111111111111';
    database.sessions.set(aliceSessionId, {
      id: aliceSessionId,
      userId: ALICE_ID,
      title: 'Alice Ongoing Analysis',
      problemStatement: 'Tension between speed and quality',
      currentMode: 'understand',
      currentStage: 'describe_problem',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      insights: [],
    });

    const bobCoThinkReq = createAuthRequest(
      'http://localhost:3000/api/cothink',
      'POST',
      BOB_TOKEN,
      {
        sessionId: aliceSessionId,
        step: 'describe_problem',
        userMessage: 'Bob injecting unwanted input into Alice session',
      }
    );
    const bobCoThinkRes = await postCoThink(bobCoThinkReq);
    assert.strictEqual(bobCoThinkRes.status, 404, 'Advancing foreign session via /api/cothink must return 404');
    const bobCoThinkBody = await bobCoThinkRes.json();
    assert.ok(bobCoThinkBody.error.includes('Unauthorized or non-existent session'));
  });

  it('Workflow Transition Isolation: User B cannot transition User A session mode via /api/workflow/transition', async () => {
    const aliceSessionId = '00000000-0000-0000-0000-111111111111';
    database.sessions.set(aliceSessionId, {
      id: aliceSessionId,
      userId: ALICE_ID,
      title: 'Alice Workflow State',
      problemStatement: 'Evaluating alternatives',
      currentMode: 'understand',
      currentStage: 'break_subproblems',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      insights: [],
    });

    const bobTransitionReq = createAuthRequest(
      'http://localhost:3000/api/workflow/transition',
      'POST',
      BOB_TOKEN,
      {
        sessionId: aliceSessionId,
        fromMode: 'understand',
        toMode: 'explore',
        reason: 'Bob trying to force mode transition',
      }
    );
    const bobTransitionRes = await postTransition(bobTransitionReq);
    assert.strictEqual(bobTransitionRes.status, 404, 'Transitioning foreign session mode must return 404');
    assert.strictEqual(
      database.sessions.get(aliceSessionId)?.currentMode,
      'understand',
      "Alice's session mode must remain unchanged"
    );
  });
});
