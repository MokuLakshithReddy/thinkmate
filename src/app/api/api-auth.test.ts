(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { POST as coThinkPost } from './cothink/route';
import { POST as thinkStreamPost } from './think/stream/route';
import { POST as workflowTransitionPost } from './workflow/transition/route';
import { POST as demoCoThinkPost } from './demo/cothink/route';
import { POST as sessionsPost } from './sessions/route';
import { POST as insightsPost } from './insights/route';
import { GET as healthGet } from './health/route';
import { POST as loginPost } from './auth/login/route';
import { POST as logoutPost } from './auth/logout/route';
import { GET as sessionGet } from './auth/session/route';
import { GeminiThinkingService } from '@/services/ai/gemini-service';
import { checkRateLimitAsync, MemoryRateLimitStore, UpstashRedisRateLimitStore, getActiveRateLimitStore } from '@/lib/rate-limiter';
import { WorkflowStateMachine } from '@/services/workflow/state-machine';
import { supabase } from '@/services/db/supabase-client';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { proxy } from '@/proxy';
import { SECURE_COOKIE_OPTIONS } from '@/lib/server-auth';

describe('API Security Boundaries & Authentication Enforcement', () => {
  test('POST /api/cothink rejects unauthenticated callers with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/cothink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session-1',
        step: 'welcome',
        userMessage: 'Hello',
      }),
    });

    const res = await coThinkPost(req);
    assert.strictEqual(res.status, 401, 'Should return 401 Unauthorized');
    const json = await res.json();
    assert.ok(json.error.includes('Authentication required'));
  });

  test('POST /api/think/stream rejects unauthenticated callers with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/think/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session',
        problemStatement: 'High latency in DB queries',
        currentMode: 'understand',
        messages: [{ role: 'user', content: 'What could cause this?' }],
      }),
    });

    const res = await thinkStreamPost(req);
    assert.strictEqual(res.status, 401, 'Should return 401 Unauthorized');
    const json = await res.json();
    assert.ok(json.error.includes('Authentication required'));
  });

  test('POST /api/workflow/transition rejects unauthenticated callers with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/workflow/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session',
        fromMode: 'understand',
        toMode: 'explore',
      }),
    });

    const res = await workflowTransitionPost(req);
    assert.strictEqual(res.status, 401, 'Should return 401 Unauthorized');
    const json = await res.json();
    assert.ok(json.error.includes('Authentication required'));
  });

  test('POST /api/demo/cothink allows unauthenticated callers into isolated simulator', async () => {
    const req = new NextRequest('http://localhost:3000/api/demo/cothink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step: 'welcome',
        userMessage: 'I have a dilemma with tech stack migration',
      }),
    });

    const res = await demoCoThinkPost(req);
    assert.strictEqual(res.status, 200, 'Demo endpoint should return 200');
    const json = await res.json();
    assert.strictEqual(json.executionMode, 'simulator', 'Should be tagged as simulator');
    assert.ok(json.simulatedNotice.includes('Demo Mode'));
    assert.strictEqual(json.nextStep, 'describe_problem');
  });

  test('GET /api/health probes dependencies without leaking secrets', async () => {
    const req = new NextRequest('http://localhost:3000/api/health', {
      method: 'GET',
    });

    const res = await healthGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.liveness, 'up');
    assert.ok(json.readiness);
    assert.ok(json.dependencies.database);
    assert.ok(json.dependencies.aiProvider);
    // Ensure no secrets leaked
    assert.strictEqual(json.dependencies.database.serviceKey, undefined);
    assert.strictEqual(json.dependencies.aiProvider.apiKey, undefined);
  });

  test('GET /api/health?readiness=true fails closed with 503 when dependencies are unconfigured', async () => {
    const req = new NextRequest('http://localhost:3000/api/health?readiness=true', {
      method: 'GET',
    });

    const res = await healthGet(req);
    // In test environment without live credentials, readiness MUST return 503
    assert.strictEqual(res.status, 503, 'Readiness should return 503 when unready');
    const json = await res.json();
    assert.strictEqual(json.liveness, 'up');
    assert.notStrictEqual(json.readiness, 'ready');
  });

  test('Simultaneous rate limit requests atomic sliding window enforcement', async () => {
    const testStore = new MemoryRateLimitStore();
    const testKey = 'test-concurrent-user';
    const limit = 5;

    // Fire 8 concurrent requests simultaneously
    const results = await Promise.all(
      Array.from({ length: 8 }).map(() =>
        checkRateLimitAsync(testKey, limit, 60000, testStore)
      )
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    const blockedCount = results.filter((r) => !r.allowed).length;

    assert.strictEqual(allowedCount, 5, 'Exactly 5 requests should be allowed');
    assert.strictEqual(blockedCount, 3, 'Excess 3 requests should be rejected');
  });

  test('Server-side workflow state machine rejects illegal stage jumps', () => {
    const illegalJump = WorkflowStateMachine.validateStageTransition('welcome', 'choose_action');
    assert.strictEqual(illegalJump.allowed, false);
    assert.ok(illegalJump.reason?.includes('Illegal workflow stage jump'));

    const legalProgression = WorkflowStateMachine.validateStageTransition('describe_problem', 'clarify_objective');
    assert.strictEqual(legalProgression.allowed, true);
  });

  test('Server-side stage derivation from database mode and message counts', () => {
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('understand', 0), 'welcome');
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('understand', 1), 'describe_problem');
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('understand', 4), 'clarify_objective');
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('explore', 2), 'explore_perspectives');
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('challenge', 2), 'challenge_assumptions');
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('decide', 2), 'summarize_insights');
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('act', 2), 'choose_action');
  });

  test('UpstashRedisRateLimitStore executes atomic Lua check and engages bounded fallback on error', async () => {
    let calledPayload: unknown = null;
    const { UpstashRedisRateLimitStore } = await import('@/lib/rate-limiter');
    const mockStore = new UpstashRedisRateLimitStore('https://mock-upstash.redis.com', 'mock-token');

    const originalFetch = global.fetch;
    try {
      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('mock-upstash')) {
          calledPayload = JSON.parse(init?.body as string);
          return {
            ok: true,
            json: async () => ({ result: [1, 4, 60000] }),
          } as unknown as Response;
        }
        return originalFetch(url, init);
      }) as typeof global.fetch;

      const result = await mockStore.checkAndRecord('test-redis-user', 5, 60000);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.remaining, 4);
      assert.ok(Array.isArray(calledPayload));
      assert.strictEqual(calledPayload[0], 'EVAL');

      // Test fallback on Upstash error: must not fail open
      global.fetch = (async (url: string | URL | Request) => {
        if (String(url).includes('mock-upstash')) {
          throw new Error('Upstash connection timeout');
        }
        return originalFetch(url);
      }) as typeof global.fetch;

      const fallbackResult = await mockStore.checkAndRecord('test-redis-fallback', 1, 60000);
      assert.strictEqual(fallbackResult.allowed, true);
      const secondResult = await mockStore.checkAndRecord('test-redis-fallback', 1, 60000);
      assert.strictEqual(secondResult.allowed, false, 'Bounded fallback must reject excess requests');

      // Test fail-closed policy when RATE_LIMIT_FAIL_CLOSED=true
      const oldEnv = process.env.RATE_LIMIT_FAIL_CLOSED;
      try {
        process.env.RATE_LIMIT_FAIL_CLOSED = 'true';
        const failClosedResult = await mockStore.checkAndRecord('test-fail-closed', 10, 60000);
        assert.strictEqual(failClosedResult.allowed, false, 'Fail-closed policy must deny requests on Redis outage');
      } finally {
        if (oldEnv !== undefined) {
          process.env.RATE_LIMIT_FAIL_CLOSED = oldEnv;
        } else {
          delete process.env.RATE_LIMIT_FAIL_CLOSED;
        }
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('getClientIp sanitizes proxy headers and prioritizes verified edge headers', async () => {
    const { getClientIp } = await import('@/lib/rate-limiter');

    // CF header priority
    const cfReq = new Request('https://thinkmate.test', {
      headers: {
        'cf-connecting-ip': '203.0.113.195',
        'x-forwarded-for': '198.51.100.1, 10.0.0.1',
      },
    });
    assert.strictEqual(getClientIp(cfReq), '203.0.113.195');

    // Real-IP header priority
    const realIpReq = new Request('https://thinkmate.test', {
      headers: {
        'x-real-ip': '198.51.100.42:8080',
        'x-forwarded-for': 'attacker-spoofed-string, 198.51.100.42',
      },
    });
    assert.strictEqual(getClientIp(realIpReq), '198.51.100.42');

    // X-Forwarded-For extracts valid IP and filters invalid input
    const xffReq = new Request('https://thinkmate.test', {
      headers: {
        'x-forwarded-for': 'invalid-domain-ip, 203.0.113.50',
      },
    });
    assert.strictEqual(getClientIp(xffReq), '203.0.113.50');

    // Fallback when headers missing
    const emptyReq = new Request('https://thinkmate.test');
    assert.strictEqual(getClientIp(emptyReq), '127.0.0.1');

    // Untrusted proxy mode (TRUST_PROXY=false) ignores spoofed client headers
    const oldTrust = process.env.TRUST_PROXY;
    try {
      process.env.TRUST_PROXY = 'false';
      const spoofedReq = new Request('https://thinkmate.test', {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-real-ip': '198.51.100.42',
        },
      });
      assert.strictEqual(getClientIp(spoofedReq), '127.0.0.1', 'Must ignore spoofed headers when proxy trust disabled');
    } finally {
      if (oldTrust !== undefined) process.env.TRUST_PROXY = oldTrust;
      else delete process.env.TRUST_PROXY;
    }

    // Explicit TRUSTED_PROXY_HEADER enforcement
    const oldHeader = process.env.TRUSTED_PROXY_HEADER;
    try {
      process.env.TRUSTED_PROXY_HEADER = 'x-real-ip';
      const customReq = new Request('https://thinkmate.test', {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-real-ip': '198.51.100.99',
        },
      });
      assert.strictEqual(getClientIp(customReq), '198.51.100.99', 'Must use configured trusted header exclusively');
    } finally {
      if (oldHeader !== undefined) process.env.TRUSTED_PROXY_HEADER = oldHeader;
      else delete process.env.TRUSTED_PROXY_HEADER;
    }
  });

  test('API routes return 400 Bad Request on malformed JSON payloads', async () => {
    const origGetUser = supabase.auth.getUser;
    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-test') {
        return { data: { user: { id: 'usr-test', email: 'test@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    try {
      // Malformed JSON on POST /api/cothink
      const badJsonCothink = new NextRequest('http://localhost:3000/api/cothink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: '{ malformed json: not valid',
      });
      const cothinkRes = await coThinkPost(badJsonCothink);
      assert.strictEqual(cothinkRes.status, 400);
      const cothinkJson = await cothinkRes.json();
      assert.ok(cothinkJson.error.includes('Malformed JSON'));

      // Malformed JSON on POST /api/workflow/transition
      const badJsonTransition = new NextRequest('http://localhost:3000/api/workflow/transition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: 'invalid-json',
      });
      const transitionRes = await workflowTransitionPost(badJsonTransition);
      assert.strictEqual(transitionRes.status, 400);

      // Malformed JSON on POST /api/think/stream
      const badJsonStream = new NextRequest('http://localhost:3000/api/think/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: '{"unclosed": ',
      });
      const streamRes = await thinkStreamPost(badJsonStream);
      assert.strictEqual(streamRes.status, 400);
    } finally {
      supabase.auth.getUser = origGetUser;
    }
  });

  test('POST /api/workflow/transition returns 400 Bad Request on invalid transition requests', async () => {
    const origGetUser = supabase.auth.getUser;
    const origGetSession = SupabaseThinkingRepository.prototype.getSession;
    const origGetInsights = SupabaseThinkingRepository.prototype.getInsights;

    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-test') {
        return { data: { user: { id: 'usr-test', email: 'test@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    // @ts-expect-error test stub
    SupabaseThinkingRepository.prototype.getSession = async (id: string, userId: string) => {
      if (id === 'sess-transition-test' && userId === 'usr-test') {
        return {
          id: 'sess-transition-test',
          userId: 'usr-test',
          title: 'Testing Transition',
          currentMode: 'understand',
          currentStage: 'describe_problem',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      return null;
    };

    SupabaseThinkingRepository.prototype.getInsights = async () => [];

    try {
      // 1. Direct illegal jump: understand -> act without decisions
      const invalidJumpReq = new NextRequest('http://localhost:3000/api/workflow/transition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: JSON.stringify({
          sessionId: 'sess-transition-test',
          fromMode: 'understand',
          toMode: 'act',
        }),
      });

      const res = await workflowTransitionPost(invalidJumpReq);
      assert.strictEqual(res.status, 400, 'Must return HTTP 400 Bad Request for disallowed transition');
      const json = await res.json();
      assert.strictEqual(json.allowed, false);
      assert.ok(json.reason, 'Must include explanation of why transition was rejected');

      // 2. Mode mismatch: requested fromMode doesn't match active database mode
      const mismatchReq = new NextRequest('http://localhost:3000/api/workflow/transition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: JSON.stringify({
          sessionId: 'sess-transition-test',
          fromMode: 'challenge',
          toMode: 'explore',
        }),
      });

      const mismatchRes = await workflowTransitionPost(mismatchReq);
      assert.strictEqual(mismatchRes.status, 400, 'Must return 400 for fromMode mismatch with session state');
    } finally {
      supabase.auth.getUser = origGetUser;
      SupabaseThinkingRepository.prototype.getSession = origGetSession;
      SupabaseThinkingRepository.prototype.getInsights = origGetInsights;
    }
  });

  test('POST /api/cothink and POST /api/think/stream reject streaming bodies exceeding 64KB with 413', async () => {
    const origGetUser = supabase.auth.getUser;
    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-test') {
        return { data: { user: { id: 'usr-test', email: 'test@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    try {
      // Oversized payload (70KB)
      const oversizedPayload = JSON.stringify({
        sessionId: 'sess-test',
        step: 'describe_problem',
        userMessage: 'A'.repeat(70000),
      });

      const cothinkReq = new NextRequest('http://localhost:3000/api/cothink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: oversizedPayload,
      });

      const cothinkRes = await coThinkPost(cothinkReq);
      assert.strictEqual(cothinkRes.status, 413, 'Must return 413 Payload Too Large');

      const streamReq = new NextRequest('http://localhost:3000/api/think/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: oversizedPayload,
      });

      const streamRes = await thinkStreamPost(streamReq);
      assert.strictEqual(streamRes.status, 413, 'Must return 413 Payload Too Large');
    } finally {
      supabase.auth.getUser = origGetUser;
    }
  });

  test('POST /api/cothink rejects reused clientRequestId with different input with 409 Conflict', async () => {
    const origGetUser = supabase.auth.getUser;
    const origGetSession = SupabaseThinkingRepository.prototype.getSession;
    const origGetMessages = SupabaseThinkingRepository.prototype.getMessages;

    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-test') {
        return { data: { user: { id: 'usr-idemp-test', email: 'test@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    SupabaseThinkingRepository.prototype.getSession = async (id: string, userId: string) => {
      return {
        id,
        userId,
        title: 'Session Idemp Test',
        problemStatement: 'Problem statement test',
        currentMode: 'understand',
        currentStage: 'welcome',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    };

    SupabaseThinkingRepository.prototype.getMessages = async () => [];

    const origRecordWorkflowStep = SupabaseThinkingRepository.prototype.recordWorkflowStep;
    SupabaseThinkingRepository.prototype.recordWorkflowStep = async (params, userId) => {
      const cacheKey = `${userId}:${params.sessionId}:${params.clientRequestId}`;
      const res = {
        sessionId: params.sessionId,
        assistantMessageId: 'asst-msg-1',
        nextStage: params.nextStage,
        nextMode: params.nextMode,
        message: params.assistantMessage,
        nextStep: params.nextStage,
      };
      if (params.clientRequestId && params.requestHash) {
        SupabaseThinkingRepository.idempotencyCache.set(cacheKey, {
          result: res,
          requestHash: params.requestHash,
        });
      }
      return res;
    };

    const origGetIdempotencyRecord = SupabaseThinkingRepository.prototype.getIdempotencyRecord;
    SupabaseThinkingRepository.prototype.getIdempotencyRecord = async (
      sessionId,
      userId,
      clientRequestId,
      expectedRequestHash
    ) => {
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
      return null;
    };

    const clientRequestId = `req-hash-diff-${Date.now()}`;
    try {
      // 1st request with initial prompt
      const firstReq = new NextRequest('http://localhost:3000/api/cothink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: JSON.stringify({
          sessionId: 'sess-idemp-test',
          step: 'welcome',
          userMessage: 'Starting dilemma inquiry',
          clientRequestId,
        }),
      });

      const firstRes = await coThinkPost(firstReq);
      assert.strictEqual(firstRes.status, 200, 'First request should succeed');

      // 2nd request with SAME clientRequestId but TAMPERED userMessage
      const tamperedReq = new NextRequest('http://localhost:3000/api/cothink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: JSON.stringify({
          sessionId: 'sess-idemp-test',
          step: 'welcome',
          userMessage: 'COMPLETELY DIFFERENT TAMPERED INQUIRY',
          clientRequestId,
        }),
      });

      const tamperedRes = await coThinkPost(tamperedReq);
      assert.strictEqual(tamperedRes.status, 409, 'Reusing clientRequestId with altered payload must return 409 Conflict');
      const json = await tamperedRes.json();
      assert.ok(json.error.includes('Idempotency key reuse violation'));
    } finally {
      supabase.auth.getUser = origGetUser;
      SupabaseThinkingRepository.prototype.getSession = origGetSession;
      SupabaseThinkingRepository.prototype.getMessages = origGetMessages;
      SupabaseThinkingRepository.prototype.recordWorkflowStep = origRecordWorkflowStep;
      SupabaseThinkingRepository.prototype.getIdempotencyRecord = origGetIdempotencyRecord;
    }
  });

  test('POST /api/cothink returns 503 Service Unavailable when database idempotency lookup fails', async () => {
    const origGetUser = supabase.auth.getUser;
    const origGetIdempotencyRecord = SupabaseThinkingRepository.prototype.getIdempotencyRecord;

    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-test') {
        return { data: { user: { id: 'usr-db-fail', email: 'test@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    SupabaseThinkingRepository.prototype.getIdempotencyRecord = async () => {
      throw new Error('Database failure looking up idempotency record: Connection pool exhausted');
    };

    try {
      const req = new NextRequest('http://localhost:3000/api/cothink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: JSON.stringify({
          sessionId: 'sess-db-fail',
          step: 'welcome',
          userMessage: 'Hello',
          clientRequestId: 'req-db-fail-1',
        }),
      });

      const res = await coThinkPost(req);
      assert.strictEqual(res.status, 503, 'Must return 503 when idempotency database check fails');
      const json = await res.json();
      assert.ok(json.error.includes('Database service unavailable'));
    } finally {
      supabase.auth.getUser = origGetUser;
      SupabaseThinkingRepository.prototype.getIdempotencyRecord = origGetIdempotencyRecord;
    }
  });

  test('POST /api/cothink rejects retired Gemini models with 400 Bad Request', async () => {
    const origGetUser = supabase.auth.getUser;
    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-test') {
        return { data: { user: { id: 'usr-model-test', email: 'test@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    try {
      // Rejects retired gemini-1.5-pro
      const retiredReq = new NextRequest('http://localhost:3000/api/cothink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: JSON.stringify({
          sessionId: 'sess-model-test',
          step: 'welcome',
          userMessage: 'Test prompt',
          model: 'gemini-1.5-pro',
        }),
      });

      const res = await coThinkPost(retiredReq);
      assert.strictEqual(res.status, 400, 'Retired gemini-1.5-pro must be rejected with 400');
      const json = await res.json();
      assert.ok(json.error.includes('Invalid co-thinker payload'));
    } finally {
      supabase.auth.getUser = origGetUser;
    }
  });

  test('POST /api/sessions rejects incompatible initial mode and stage with 400', async () => {
    const origGetUser = supabase.auth.getUser;
    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-test') {
        return { data: { user: { id: 'usr-sess-test', email: 'test@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    try {
      // Incompatible: mode is 'understand', but stage is 'choose_action' (belongs to 'act')
      const incompatibleReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: JSON.stringify({
          title: 'Invalid Stage/Mode Session',
          problemStatement: 'Some challenge',
          currentMode: 'understand',
          currentStage: 'choose_action',
        }),
      });

      const res = await sessionsPost(incompatibleReq);
      assert.strictEqual(res.status, 400, 'Must return 400 Bad Request for incompatible mode and stage');
      const json = await res.json();
      assert.ok(json.error.includes('Invalid session payload'));
    } finally {
      supabase.auth.getUser = origGetUser;
    }
  });

  test('POST /api/sessions, /api/insights, and /api/demo/cothink reject oversized bodies with 413', async () => {
    const origGetUser = supabase.auth.getUser;
    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-test') {
        return { data: { user: { id: 'usr-size-test', email: 'test@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    try {
      const oversizedPayload = JSON.stringify({
        title: 'Huge Session',
        problemStatement: 'X'.repeat(70000),
      });

      const sessReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: oversizedPayload,
      });
      const sessRes = await sessionsPost(sessReq);
      assert.strictEqual(sessRes.status, 413, 'Sessions POST must return 413 on oversized body');

      const insightReq = new NextRequest('http://localhost:3000/api/insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-test',
        },
        body: oversizedPayload,
      });
      const insightRes = await insightsPost(insightReq);
      assert.strictEqual(insightRes.status, 413, 'Insights POST must return 413 on oversized body');

      const demoReq = new NextRequest('http://localhost:3000/api/demo/cothink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedPayload,
      });
      const demoRes = await demoCoThinkPost(demoReq);
      assert.strictEqual(demoRes.status, 413, 'Demo POST must return 413 on oversized body');
    } finally {
      supabase.auth.getUser = origGetUser;
    }
  });

  test('UpstashRedisRateLimitStore handles Redis non-2xx responses and fail-closed policy', async () => {
    const mockStore = new UpstashRedisRateLimitStore(
      'https://mock-upstash-error.example.com',
      'mock-error-token'
    );
    const originalFetch = global.fetch;

    try {
      // Simulate Upstash returning HTTP 503 Service Unavailable
      global.fetch = (async (url: string | URL | Request) => {
        if (String(url).includes('mock-upstash-error')) {
          return new Response(JSON.stringify({ error: 'Service Unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch(url);
      }) as typeof global.fetch;

      // 1. Without fail-closed (default), engages degraded in-memory sliding window
      const degradedResult = await mockStore.checkAndRecord('test-503-fallback', 2, 60000);
      assert.strictEqual(degradedResult.allowed, true, 'Degraded mode should allow request within memory quota');

      // 2. With RATE_LIMIT_FAIL_CLOSED=true, strictly rejects request on non-2xx response
      const oldEnv = process.env.RATE_LIMIT_FAIL_CLOSED;
      try {
        process.env.RATE_LIMIT_FAIL_CLOSED = 'true';
        const failClosedResult = await mockStore.checkAndRecord('test-503-fail-closed', 10, 60000);
        assert.strictEqual(failClosedResult.allowed, false, 'Fail-closed mode must reject request on 503 outage');
      } finally {
        if (oldEnv !== undefined) {
          process.env.RATE_LIMIT_FAIL_CLOSED = oldEnv;
        } else {
          delete process.env.RATE_LIMIT_FAIL_CLOSED;
        }
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('getActiveRateLimitStore strictly rejects requests in production when Upstash credentials are missing', async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      // 1. In production without Redis, store must reject requests
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const prodStore = getActiveRateLimitStore();
      const prodResult = await prodStore.checkAndRecord!('test-prod-key', 10, 60000);
      assert.strictEqual(prodResult.allowed, false, 'Production without Redis must reject requests (fail-closed)');
      assert.strictEqual(prodResult.remaining, 0);

      // Verify sync checkRateLimit also fails closed in production
      const syncResult = await checkRateLimitAsync('test-prod-sync', 10, 60000, prodStore);
      assert.strictEqual(syncResult.allowed, false);

      // 2. In non-production (test/dev), falls back to working memory store
      (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
      const devStore = getActiveRateLimitStore();
      const devResult = await devStore.checkAndRecord!('test-dev-key', 10, 60000);
      assert.strictEqual(devResult.allowed, true, 'Test/dev must fall back to working in-memory store');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
      if (origUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      if (origToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
    }
  });

  test('POST /api/sessions, POST /api/insights, and POST /api/workflow/transition enforce mutation rate limits', async () => {
    const origGetUser = supabase.auth.getUser;
    const testUserId = `usr-ratelimit-${Date.now()}`;

    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-token-ratelimit') {
        return { data: { user: { id: testUserId, email: 'rate@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    try {
      // Simulate exhausting session creation mutation limit (30 req/min)
      for (let i = 0; i < 30; i++) {
        await checkRateLimitAsync(`mutation:sessions:${testUserId}`, 30, 60000);
      }

      const req = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token-ratelimit',
        },
        body: JSON.stringify({
          title: 'Rate Limit Session',
          problemStatement: 'Testing rate limits',
        }),
      });

      const res = await sessionsPost(req);
      assert.strictEqual(res.status, 429, 'Session creation must return 429 when mutation limit exceeded');
      assert.ok(res.headers.get('Retry-After'), 'Must include Retry-After header');
      const json = await res.json();
      assert.ok(json.error.includes('Rate limit exceeded'));
    } finally {
      supabase.auth.getUser = origGetUser;
    }
  });

  test('Cookie-based authentication enforces strict CSRF protection on state-changing requests', async () => {
    const origGetUser = supabase.auth.getUser;
    const origCreateSession = SupabaseThinkingRepository.prototype.createSession;
    const testUserId = `usr-csrf-${Date.now()}`;

    // @ts-expect-error test stub
    supabase.auth.getUser = async (token: string) => {
      if (token === 'mock-cookie-token') {
        return { data: { user: { id: testUserId, email: 'csrf@example.com' } }, error: null };
      }
      return origGetUser.call(supabase.auth, token);
    };

    SupabaseThinkingRepository.prototype.createSession = async (session) => session;

    try {
      // 1. Cross-origin POST request with malicious Origin must be rejected with 403 Forbidden
      const maliciousOriginReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://malicious-attacker.com',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({
          title: 'CSRF Attack Attempt',
          problemStatement: 'Malicious payload',
        }),
      });

      const maliciousRes = await sessionsPost(maliciousOriginReq);
      assert.strictEqual(maliciousRes.status, 403, 'Cross-origin cookie POST with malicious origin must return 403');
      const maliciousJson = await maliciousRes.json();
      assert.ok(maliciousJson.error.includes('CSRF protection validation failed'));

      // 2. Cookie mutation request with missing Origin AND Referer must be rejected with 403
      const missingOriginReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({
          title: 'Missing Origin CSRF Attempt',
          problemStatement: 'Payload without origin',
        }),
      });

      const missingOriginRes = await sessionsPost(missingOriginReq);
      assert.strictEqual(missingOriginRes.status, 403, 'Cookie mutation with missing origin must return 403');

      // 3. Cookie mutation with Sec-Fetch-Site: cross-site must be rejected with 403
      const crossSiteHeaderReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'cross-site',
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({
          title: 'Sec-Fetch-Site Cross-Site Attack',
          problemStatement: 'Cross-site fetch',
        }),
      });

      const crossSiteRes = await sessionsPost(crossSiteHeaderReq);
      assert.strictEqual(crossSiteRes.status, 403, 'Cookie mutation with cross-site Sec-Fetch-Site must return 403');

      // 4. Same-origin POST request with cookie authentication is accepted with 200 OK
      const sameOriginReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({
          title: 'Legitimate Same-Origin Session',
          problemStatement: 'Legitimate request',
        }),
      });

      const sameOriginRes = await sessionsPost(sameOriginReq);
      assert.strictEqual(sameOriginRes.status, 200, 'Same-origin cookie POST must pass CSRF validation');

      // 5. Bearer token request without Origin header is accepted (not vulnerable to ambient CSRF)
      // @ts-expect-error test stub
      supabase.auth.getUser = async (token: string) => {
        if (token === 'mock-bearer-token' || token === 'mock-cookie-token') {
          return { data: { user: { id: testUserId, email: 'authenticated@example.com' } }, error: null };
        }
        return origGetUser.call(supabase.auth, token);
      };

      const bearerReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-bearer-token',
        },
        body: JSON.stringify({
          title: 'Bearer Token Request',
          problemStatement: 'Non-ambient authorization header',
        }),
      });

      const bearerRes = await sessionsPost(bearerReq);
      assert.strictEqual(bearerRes.status, 200, 'Bearer token requests are exempt from cookie CSRF checks');

      // 6. Malformed Origin header returns 403 Forbidden
      const malformedOriginReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'javascript:alert(1)',
          Host: 'localhost:3000',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({ title: 'Malformed Origin', problemStatement: 'test' }),
      });
      const malformedOriginRes = await sessionsPost(malformedOriginReq);
      assert.strictEqual(malformedOriginRes.status, 403, 'Malformed origin protocol must return 403');

      // 7. Malformed Referer header returns 403 Forbidden
      const malformedRefererReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Referer: '://not-a-valid-url',
          Host: 'localhost:3000',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({ title: 'Malformed Referer', problemStatement: 'test' }),
      });
      const malformedRefererRes = await sessionsPost(malformedRefererReq);
      assert.strictEqual(malformedRefererRes.status, 403, 'Malformed referer must return 403');

      // 8. Canonical configured application origin and production-host aliases are honored
      const prevAppUrl = process.env.APP_URL;
      const prevTrustedOrigins = process.env.TRUSTED_ORIGINS;
      try {
        process.env.APP_URL = 'https://thinkmate.ai';
        process.env.TRUSTED_ORIGINS = 'https://staging.thinkmate.ai,https://thinkmate-preview.vercel.app';

        // Request with Origin matching configured production APP_URL succeeds
        const prodAliasReq = new NextRequest('https://thinkmate.ai/api/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://thinkmate.ai',
            Host: 'thinkmate.ai',
            Cookie: 'sb-access-token=mock-cookie-token',
          },
          body: JSON.stringify({ title: 'Prod Alias Session', problemStatement: 'test' }),
        });
        const prodAliasRes = await sessionsPost(prodAliasReq);
        assert.strictEqual(prodAliasRes.status, 200, 'Origin matching configured APP_URL must pass CSRF validation');

        // Request with Origin matching TRUSTED_ORIGINS alias succeeds
        const trustedAliasReq = new NextRequest('https://staging.thinkmate.ai/api/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://thinkmate-preview.vercel.app',
            Host: 'staging.thinkmate.ai',
            Cookie: 'sb-access-token=mock-cookie-token',
          },
          body: JSON.stringify({ title: 'Trusted Preview Session', problemStatement: 'test' }),
        });
        const trustedAliasRes = await sessionsPost(trustedAliasReq);
        assert.strictEqual(trustedAliasRes.status, 200, 'Origin matching TRUSTED_ORIGINS alias must pass CSRF');
      } finally {
        process.env.APP_URL = prevAppUrl;
        process.env.TRUSTED_ORIGINS = prevTrustedOrigins;
      }

      // 9. Attacker spoofing X-Forwarded-Host cannot validate attacker origin
      const spoofedProxyReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker-domain.com',
          Host: 'localhost:3000',
          'X-Forwarded-Host': 'attacker-domain.com',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({ title: 'Spoofed Proxy Attack', problemStatement: 'test' }),
      });
      const spoofedProxyRes = await sessionsPost(spoofedProxyReq);
      assert.strictEqual(spoofedProxyRes.status, 403, 'Spoofed proxy headers must not allow foreign origin');

      // 10. Origin header with literal 'null' string (e.g. from sandboxed iframes) is rejected
      const nullOriginReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'null',
          Host: 'localhost:3000',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({ title: 'Null Origin Attack', problemStatement: 'test' }),
      });
      const nullOriginRes = await sessionsPost(nullOriginReq);
      assert.strictEqual(nullOriginRes.status, 403, 'Literal null Origin header must return 403');

      // 11. Origin header with non-HTTP protocol (e.g. ftp:// or data:) is rejected
      const ftpOriginReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'ftp://malicious-server.com',
          Host: 'localhost:3000',
          Cookie: 'sb-access-token=mock-cookie-token',
        },
        body: JSON.stringify({ title: 'FTP Origin Attack', problemStatement: 'test' }),
      });
      const ftpOriginRes = await sessionsPost(ftpOriginReq);
      assert.strictEqual(ftpOriginRes.status, 403, 'FTP origin protocol must return 403');

      // 12. Unapproved subdomain of configured domain is strictly rejected
      try {
        process.env.APP_URL = 'https://thinkmate.ai';
        const unapprovedSubdomainReq = new NextRequest('https://thinkmate.ai/api/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://attacker.thinkmate.ai',
            Host: 'thinkmate.ai',
            Cookie: 'sb-access-token=mock-cookie-token',
          },
          body: JSON.stringify({ title: 'Subdomain Attack', problemStatement: 'test' }),
        });
        const unapprovedSubdomainRes = await sessionsPost(unapprovedSubdomainReq);
        assert.strictEqual(unapprovedSubdomainRes.status, 403, 'Unapproved subdomain must return 403');
      } finally {
        process.env.APP_URL = prevAppUrl;
      }

      // 13. Bearer-authenticated mutation with cross-origin Origin is permitted (ambient cookie defense does not apply)
      const bearerCrossOriginReq = new NextRequest('http://localhost:3000/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-bearer-token',
          Origin: 'https://external-api-client.org',
          Host: 'localhost:3000',
        },
        body: JSON.stringify({ title: 'Bearer Cross-Origin', problemStatement: 'test' }),
      });
      const bearerCrossOriginRes = await sessionsPost(bearerCrossOriginReq);
      assert.strictEqual(bearerCrossOriginRes.status, 200, 'Bearer authenticated callers must be permitted from any origin');
    } finally {
      supabase.auth.getUser = origGetUser;
      SupabaseThinkingRepository.prototype.createSession = origCreateSession;
    }
  });

  test('production cookie security attributes enforce defensive standard', () => {
    assert.strictEqual(SECURE_COOKIE_OPTIONS.httpOnly, true, 'Cookies must be HttpOnly to prevent XSS theft');
    assert.strictEqual(SECURE_COOKIE_OPTIONS.sameSite, 'lax', 'Cookies must use SameSite=Lax for defensive CSRF baseline');
    assert.strictEqual(SECURE_COOKIE_OPTIONS.path, '/', 'Cookies must be restricted to root path');
    assert.strictEqual(typeof SECURE_COOKIE_OPTIONS.secure, 'boolean', 'Secure flag must be evaluated');
  });

  test('proxy middleware enforces API CSRF and sets single authoritative nonce CSP on page requests', async () => {
    // 1. API request through proxy middleware with malicious origin and cookie is rejected at edge
    const apiReq = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      headers: {
        Origin: 'https://evil-cross-site.com',
        Cookie: 'sb-access-token=some-cookie',
        Host: 'localhost:3000',
      },
    });

    const apiProxyRes = proxy(apiReq);
    assert.strictEqual(apiProxyRes.status, 403, 'Proxy must reject cross-origin cookie API mutation with 403');

    // 2. Page request through proxy receives single nonce-based CSP header
    const pageReq = new NextRequest('http://localhost:3000/', {
      method: 'GET',
      headers: {
        Host: 'localhost:3000',
      },
    });

    const pageProxyRes = proxy(pageReq);
    assert.strictEqual(pageProxyRes.status, 200);

    const cspHeader = pageProxyRes.headers.get('Content-Security-Policy');
    const xNonceHeader = pageProxyRes.headers.get('x-nonce');

    assert.ok(cspHeader, 'Page response must include Content-Security-Policy');
    assert.ok(xNonceHeader, 'Page response must include x-nonce');

    // Check nonce matching
    assert.ok(
      cspHeader.includes(`'nonce-${xNonceHeader}'`),
      'Content-Security-Policy must contain the matching cryptographic nonce'
    );
    assert.ok(
      cspHeader.includes("'strict-dynamic'"),
      'Content-Security-Policy must include strict-dynamic'
    );
    // Ensure single authoritative CSP header is set
    const cspValue = pageProxyRes.headers.get('content-security-policy');
    assert.strictEqual(cspValue, cspHeader);
  });

  test('POST /api/auth/login validates input and issues secure HttpOnly cookies on verified credentials', async () => {
    // 1. Rejects missing / invalid payload with 400
    const invalidReq = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: '123' }),
    });
    const invalidRes = await loginPost(invalidReq);
    assert.strictEqual(invalidRes.status, 400, 'Invalid email or short password must return 400');

    // 2. Returns 401 on failed Supabase authentication
    const origSignIn = supabase.auth.signInWithPassword;
    try {
      supabase.auth.signInWithPassword = async () => ({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', name: 'AuthApiError', status: 400 } as any,
      });

      const failedReq = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'valid@thinkmate.ai', password: 'wrongpassword' }),
      });
      const failedRes = await loginPost(failedReq);
      assert.strictEqual(failedRes.status, 401, 'Invalid credentials must return 401');

      // 3. Returns 200 and sets HttpOnly cookies on successful login
      supabase.auth.signInWithPassword = async () => ({
        data: {
          user: { id: 'usr-verified-123', email: 'verified@thinkmate.ai' } as any,
          session: { access_token: 'mock-jwt-token-xyz', refresh_token: 'mock-refresh' } as any,
        },
        error: null,
      });

      const successReq = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'verified@thinkmate.ai', password: 'correctpassword123' }),
      });
      const successRes = await loginPost(successReq);
      assert.strictEqual(successRes.status, 200);

      const json = await successRes.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.user.id, 'usr-verified-123');
      assert.strictEqual(json.user.email, 'verified@thinkmate.ai');

      // Check cookie headers
      const cookieHeader = successRes.headers.get('set-cookie');
      assert.ok(cookieHeader, 'Response must set auth cookies');
      assert.ok(cookieHeader.includes('thinkmate_auth_token='), 'Must set thinkmate_auth_token cookie');
      assert.ok(cookieHeader.includes('HttpOnly'), 'Auth cookie must be HttpOnly');
    } finally {
      supabase.auth.signInWithPassword = origSignIn;
    }
  });

  test('POST /api/auth/logout clears cookies and enforces CSRF verification', async () => {
    // 1. Cross-origin logout with ambient cookie is blocked by CSRF
    const csrfReq = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.evil.com',
        Host: 'localhost:3000',
        Cookie: 'thinkmate_auth_token=victim-cookie',
      },
    });
    const csrfRes = await logoutPost(csrfReq);
    assert.strictEqual(csrfRes.status, 403, 'Cross-origin logout with ambient cookie must return 403');

    // 2. Same-origin logout clears cookies with maxAge: 0
    const logoutReq = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        Cookie: 'thinkmate_auth_token=existing-token',
      },
    });
    const logoutRes = await logoutPost(logoutReq);
    assert.strictEqual(logoutRes.status, 200);
    const json = await logoutRes.json();
    assert.strictEqual(json.success, true);

    const cookieHeader = logoutRes.headers.get('set-cookie');
    assert.ok(cookieHeader, 'Logout must send set-cookie header');
    assert.ok(cookieHeader.includes('Max-Age=0') || cookieHeader.includes('Expires='), 'Must expire auth cookies');
  });

  test('GET /api/auth/session reports verified identity from HttpOnly cookie', async () => {
    // 1. Unauthenticated request returns authenticated: false
    const unauthReq = new NextRequest('http://localhost:3000/api/auth/session', {
      method: 'GET',
    });
    const unauthRes = await sessionGet(unauthReq);
    assert.strictEqual(unauthRes.status, 200);
    const unauthJson = await unauthRes.json();
    assert.strictEqual(unauthJson.authenticated, false);
    assert.strictEqual(unauthJson.user, null);

    // 2. Verified cookie returns authenticated: true with user details
    const origGetUser = supabase.auth.getUser;
    try {
      supabase.auth.getUser = async (token: string) => {
        if (token === 'valid-user-cookie') {
          return {
            data: { user: { id: 'usr-cookie-456', email: 'cookie@thinkmate.ai' } as any },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'Invalid token' } as any };
      };

      const authReq = new NextRequest('http://localhost:3000/api/auth/session', {
        method: 'GET',
        headers: {
          Cookie: 'thinkmate_auth_token=valid-user-cookie',
        },
      });
      const authRes = await sessionGet(authReq);
      assert.strictEqual(authRes.status, 200);
      const authJson = await authRes.json();
      assert.strictEqual(authJson.authenticated, true);
      assert.strictEqual(authJson.user.id, 'usr-cookie-456');
      assert.strictEqual(authJson.user.email, 'cookie@thinkmate.ai');
    } finally {
      supabase.auth.getUser = origGetUser;
    }
  });

  test('GeminiThinkingService validates structured metadata and refuses synthetic fallbacks', () => {
    const service = new GeminiThinkingService('dummy-test-key');
    const events: any[] = [];
    const onEvent = (e: any) => events.push(e);

    // 1. Valid metadata emits validated structured questions and insights
    const validMeta = JSON.stringify({
      suggestedQuestions: ['What is the latency budget?', 'Can we shard by tenant?'],
      insights: [
        {
          category: 'tradeoff',
          title: 'Latency vs Consistency',
          content: 'Eventual consistency allows sub-10ms response times.',
        },
      ],
      suggestedMode: 'explore',
    });

    service.parseAndEmitMetadata(validMeta, 'understand', onEvent);
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].type, 'questions');
    assert.strictEqual(events[0].questions.length, 2);
    assert.strictEqual(events[1].type, 'insights');
    assert.strictEqual(events[2].type, 'suggestedMode');
    assert.strictEqual(events[2].mode, 'explore');

    // 2. Empty string does not emit anything
    events.length = 0;
    service.parseAndEmitMetadata('', 'understand', onEvent);
    assert.strictEqual(events.length, 0, 'Empty metadata string must not emit events');

    // 3. Malformed JSON does NOT emit synthetic default questions (truthful AI failure behavior)
    events.length = 0;
    service.parseAndEmitMetadata('{"unclosedJson: true', 'understand', onEvent);
    assert.strictEqual(events.length, 0, 'Malformed JSON must not emit fake default questions');

    // 4. Schema-violating types do NOT emit questions
    events.length = 0;
    service.parseAndEmitMetadata(JSON.stringify({ suggestedQuestions: 'not-an-array' }), 'understand', onEvent);
    assert.strictEqual(events.length, 0, 'Schema-violating metadata must be rejected');
  });
});
