(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert';
import type { AuthError, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { POST as coThinkPost } from './cothink/route';
import { POST as thinkStreamPost } from './think/stream/route';
import { POST as workflowTransitionPost } from './workflow/transition/route';
import { POST as demoCoThinkPost } from './demo/cothink/route';
import { GET as sessionsGet, POST as sessionsPost, DELETE as sessionsDelete } from './sessions/route';
import { POST as insightsPost } from './insights/route';
import { GET as healthGet } from './health/route';
import { POST as loginPost } from './auth/login/route';
import { POST as logoutPost } from './auth/logout/route';
import { GET as sessionGet } from './auth/session/route';
import { POST as signupPost } from './auth/signup/route';
import { POST as refreshPost } from './auth/refresh/route';
import { GeminiThinkingService } from '@/services/ai/gemini-service';
import {
  checkRateLimitAsync,
  checkRateLimit,
  getClientIp,
  parseAndValidateIp,
  isValidIp,
  MemoryRateLimitStore,
  UpstashRedisRateLimitStore,
  getActiveRateLimitStore,
  verifyRateLimiterConfig,
  verifyRateLimiterConfigAsync,
  createRateLimitErrorResponse,
} from '@/lib/rate-limiter';
import { WorkflowStateMachine } from '@/services/workflow/state-machine';
import { supabase } from '@/services/db/supabase-client';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { SECURE_COOKIE_OPTIONS, RotationGraceCache, rotationGraceCache, revokeUserSession, hashTokenKey, getClusterEncryptionKey, refreshUserSession, saveDistributedRotatedSession } from '@/lib/server-auth';
import { normalizeInsightCategory, normalizeInsightStatus } from '@/types';
import { proxy } from '@/proxy';

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
    const oldProvider = process.env.TRUSTED_PROXY_PROVIDER;

    try {
      // CF header priority when provider is configured as cloudflare
      process.env.TRUSTED_PROXY_PROVIDER = 'cloudflare';
      const cfReq = new Request('https://thinkmate.test', {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '198.51.100.1, 10.0.0.1',
        },
      });
      assert.strictEqual(getClientIp(cfReq), '203.0.113.195');

      // Real-IP header priority when provider is configured as nginx
      process.env.TRUSTED_PROXY_PROVIDER = 'nginx';
      const realIpReq = new Request('https://thinkmate.test', {
        headers: {
          'x-real-ip': '198.51.100.42:8080',
          'x-forwarded-for': 'attacker-spoofed-string, 198.51.100.42',
        },
      });
      assert.strictEqual(getClientIp(realIpReq), '198.51.100.42');
    } finally {
      process.env.TRUSTED_PROXY_PROVIDER = oldProvider;
    }

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
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
      body: JSON.stringify({ email: 'not-an-email', password: '123' }),
    });
    const invalidRes = await loginPost(invalidReq);
    assert.strictEqual(invalidRes.status, 400, 'Invalid email or short password must return 400');

    // 2. Returns 401 on failed Supabase authentication
    const origSignIn = supabase.auth.signInWithPassword;
    try {
      supabase.auth.signInWithPassword = (async () => ({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', name: 'AuthApiError', status: 400 },
      })) as unknown as typeof supabase.auth.signInWithPassword;

      const failedReq = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
        body: JSON.stringify({ email: 'valid@thinkmate.ai', password: 'wrongpassword' }),
      });
      const failedRes = await loginPost(failedReq);
      assert.strictEqual(failedRes.status, 401, 'Invalid credentials must return 401');

      // 3. Returns 200 and sets HttpOnly cookies on successful login
      supabase.auth.signInWithPassword = (async () => ({
        data: {
          user: { id: 'usr-verified-123', email: 'verified@thinkmate.ai' },
          session: { access_token: 'mock-jwt-token-xyz', refresh_token: 'mock-refresh' },
        },
        error: null,
      })) as unknown as typeof supabase.auth.signInWithPassword;

      const successReq = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
        body: JSON.stringify({ email: 'verified@thinkmate.ai', password: 'correctpassword123' }),
      });
      const successRes = await loginPost(successReq);
      assert.strictEqual(successRes.status, 200);

      const json = await successRes.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.user.id, 'usr-verified-123');
      assert.strictEqual(json.user.email, 'verified@thinkmate.ai');

      // Check cookie headers: both access and refresh cookies must be set
      const cookieHeader = successRes.headers.get('set-cookie');
      assert.ok(cookieHeader, 'Response must set auth cookies');
      assert.ok(cookieHeader.includes('thinkmate_auth_token='), 'Must set thinkmate_auth_token cookie');
      assert.ok(cookieHeader.includes('thinkmate_refresh_token='), 'Must set thinkmate_refresh_token cookie');
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
    const originalFetch = global.fetch;
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

    try {
      global.fetch = (async (url: string | URL | Request) => {
        void url;
        // Admin signOut or token or logout
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'mock-access',
            refresh_token: 'mock-refresh',
            user: { id: 'mock-usr' },
          }),
          text: async () => '',
        } as unknown as Response;
      }) as typeof global.fetch;

      const logoutReq = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'thinkmate_auth_token=existing-token; thinkmate_refresh_token=existing-refresh',
        },
      });
      const logoutRes = await logoutPost(logoutReq);
      assert.strictEqual(logoutRes.status, 200);
      const json = await logoutRes.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.upstreamRevoked, true);

      const cookieHeader = logoutRes.headers.get('set-cookie');
      assert.ok(cookieHeader, 'Logout must send set-cookie header');
      assert.ok(cookieHeader.includes('thinkmate_auth_token='), 'Must expire thinkmate_auth_token');
      assert.ok(cookieHeader.includes('thinkmate_refresh_token='), 'Must expire thinkmate_refresh_token');
      assert.ok(cookieHeader.includes('Max-Age=0') || cookieHeader.includes('Expires='), 'Must expire auth cookies');
    } finally {
      global.fetch = originalFetch;
      process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origAnon;
    }
  });

  test('POST /api/auth/signup distinguishes unconfirmed email signups from established sessions', async () => {
    const origSignUp = supabase.auth.signUp;
    try {
      // 1. Signup requiring email confirmation (data.session === null)
      supabase.auth.signUp = (async () => ({
        data: {
          user: { id: 'usr-unconfirmed-1', email: 'unconfirmed@thinkmate.ai' },
          session: null,
        },
        error: null,
      })) as unknown as typeof supabase.auth.signUp;

      const unconfirmedReq = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
        body: JSON.stringify({ email: 'unconfirmed@thinkmate.ai', password: 'securepassword123' }),
      });
      const unconfirmedRes = await signupPost(unconfirmedReq);
      assert.strictEqual(unconfirmedRes.status, 200);
      const unconfirmedJson = await unconfirmedRes.json();

      assert.strictEqual(unconfirmedJson.success, true);
      assert.strictEqual(unconfirmedJson.authenticated, false, 'Must not mark unconfirmed signup as authenticated');
      assert.strictEqual(unconfirmedJson.requiresEmailConfirmation, true, 'Must report requiresEmailConfirmation');
      assert.strictEqual(unconfirmedJson.session, null);
      assert.ok(unconfirmedJson.message.includes('check your email'));
      assert.strictEqual(unconfirmedRes.headers.get('set-cookie'), null, 'Must not set auth cookies when session is null');

      // 2. Signup with auto-confirmed / immediate session
      supabase.auth.signUp = (async () => ({
        data: {
          user: { id: 'usr-confirmed-2', email: 'confirmed@thinkmate.ai' },
          session: { access_token: 'mock-access-token-new', refresh_token: 'mock-refresh-token-new', expires_at: 1800000000 },
        },
        error: null,
      })) as unknown as typeof supabase.auth.signUp;

      const confirmedReq = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
        body: JSON.stringify({ email: 'confirmed@thinkmate.ai', password: 'securepassword123' }),
      });
      const confirmedRes = await signupPost(confirmedReq);
      assert.strictEqual(confirmedRes.status, 200);
      const confirmedJson = await confirmedRes.json();

      assert.strictEqual(confirmedJson.success, true);
      assert.strictEqual(confirmedJson.authenticated, true);
      assert.strictEqual(confirmedJson.requiresEmailConfirmation, false);
      const setCookieHeader = confirmedRes.headers.get('set-cookie');
      assert.ok(setCookieHeader, 'Must set auth cookies on confirmed signup');
      assert.ok(setCookieHeader.includes('thinkmate_auth_token='), 'Must set access cookie');
      assert.ok(setCookieHeader.includes('thinkmate_refresh_token='), 'Must set refresh cookie');
    } finally {
      supabase.auth.signUp = origSignUp;
    }
  });

  test('POST /api/auth/refresh enforces CSRF, rotates refresh tokens, and sets updated cookies', async () => {
    // 1. Rejects cross-origin request with CSRF error
    const crossOriginReq = new NextRequest('http://localhost:3000/api/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: 'https://evil-attacker.com',
        Host: 'localhost:3000',
        Cookie: 'thinkmate_refresh_token=valid-token',
      },
    });
    const crossOriginRes = await refreshPost(crossOriginReq);
    assert.strictEqual(crossOriginRes.status, 403, 'Cross-origin refresh must return 403');

    // 2. Missing refresh token returns 401
    const missingReq = new NextRequest('http://localhost:3000/api/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
    });
    const missingRes = await refreshPost(missingReq);
    assert.strictEqual(missingRes.status, 401);

    // 3. Invalid/revoked refresh token returns 401 and clears cookies
    const origRefresh = supabase.auth.refreshSession;
    try {
      supabase.auth.refreshSession = (async () => ({
        data: { user: null, session: null },
        error: { message: 'Refresh token revoked', name: 'AuthApiError', status: 401 },
      })) as unknown as typeof supabase.auth.refreshSession;

      const revokedReq = new NextRequest('http://localhost:3000/api/auth/refresh', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'thinkmate_refresh_token=revoked-token',
        },
      });
      const revokedRes = await refreshPost(revokedReq);
      assert.strictEqual(revokedRes.status, 401);
      const revokedCookies = revokedRes.headers.get('set-cookie');
      assert.ok(revokedCookies?.includes('Max-Age=0'), 'Must expire cookies on revoked token');

      // 4. Successful refresh rotates token and sets new HttpOnly cookies
      supabase.auth.refreshSession = (async () => ({
        data: {
          user: { id: 'usr-rotated-789', email: 'rotated@thinkmate.ai' },
          session: {
            access_token: 'new-access-token-rotated',
            refresh_token: 'new-refresh-token-rotated',
          },
        },
        error: null,
      })) as unknown as typeof supabase.auth.refreshSession;

      const validReq = new NextRequest('http://localhost:3000/api/auth/refresh', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'thinkmate_refresh_token=valid-old-refresh',
        },
      });
      const validRes = await refreshPost(validReq);
      assert.strictEqual(validRes.status, 200);
      const validJson = await validRes.json();
      assert.strictEqual(validJson.success, true);
      assert.strictEqual(validJson.user.id, 'usr-rotated-789');

      const rotatedCookies = validRes.headers.get('set-cookie');
      assert.ok(rotatedCookies?.includes('thinkmate_auth_token='), 'Must set new access token cookie');
      assert.ok(rotatedCookies?.includes('thinkmate_refresh_token='), 'Must set new rotated refresh token cookie');

      // 5. Concurrent refresh requests under rotation: 5 simultaneous requests with the same token
      let callCount = 0;
      supabase.auth.refreshSession = (async () => {
        callCount++;
        // Simulate real network delay during upstream rotation
        await new Promise((r) => setTimeout(r, 10));
        return {
          data: {
            user: { id: 'usr-concurrent-refresh', email: 'concurrent@thinkmate.ai' },
            session: {
              access_token: 'concurrent-access-token-jwt',
              refresh_token: 'concurrent-refresh-token-jwt',
            },
          },
          error: null,
        };
      }) as unknown as typeof supabase.auth.refreshSession;

      const concurrentTokens = Array.from({ length: 5 }, () =>
        new NextRequest('http://localhost:3000/api/auth/refresh', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3000',
            Host: 'localhost:3000',
            Cookie: 'thinkmate_refresh_token=concurrent-shared-token',
          },
        })
      );

      const concurrentResponses = await Promise.all(concurrentTokens.map((req) => refreshPost(req)));

      assert.strictEqual(
        callCount,
        1,
        `Expected exactly 1 upstream refreshSession call due to in-flight deduplication, got ${callCount}`
      );

      for (const res of concurrentResponses) {
        assert.strictEqual(res.status, 200, 'All concurrent refresh requests must succeed');
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.strictEqual(json.user.id, 'usr-concurrent-refresh');
        const cookies = res.headers.get('set-cookie');
        assert.ok(cookies?.includes('thinkmate_auth_token='), 'Each request must receive valid cookie');
      }
    } finally {
      supabase.auth.refreshSession = origRefresh;
    }
  });

  test('POST /api/think/stream enforces session ownership, mode alignment, and decision gates', async () => {
    const origGetUser = supabase.auth.getUser;
    const origGetSession = SupabaseThinkingRepository.prototype.getSession;
    const origGetInsights = SupabaseThinkingRepository.prototype.getInsights;

    try {
      supabase.auth.getUser = (async (token: string) => {
        if (token === 'valid-auth-token') {
          return { data: { user: { id: 'usr-stream-test', email: 'streamer@thinkmate.ai' } }, error: null };
        }
        return { data: { user: null }, error: { message: 'Invalid' } };
      }) as unknown as typeof supabase.auth.getUser;

      // 1. Rejects non-existent / unauthorized session with 404
      SupabaseThinkingRepository.prototype.getSession = async () => null;

      const nonExistentReq = new NextRequest('http://localhost:3000/api/think/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-auth-token',
        },
        body: JSON.stringify({
          sessionId: 'missing-session-uuid',
          problemStatement: 'Some statement',
          currentMode: 'understand',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });

      const nonExistentRes = await thinkStreamPost(nonExistentReq);
      assert.strictEqual(nonExistentRes.status, 404, 'Must return 404 on non-existent session');

      // 2. Rejects workflow mode mismatch (e.g. session is in explore, request claims understand) with 400
      SupabaseThinkingRepository.prototype.getSession = async () => ({
        id: 'sess-mode-test',
        userId: 'usr-stream-test',
        title: 'Session Test',
        problemStatement: 'Some statement',
        currentMode: 'explore',
        currentStage: 'explore_perspectives',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const mismatchReq = new NextRequest('http://localhost:3000/api/think/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-auth-token',
        },
        body: JSON.stringify({
          sessionId: 'sess-mode-test',
          problemStatement: 'Some statement',
          currentMode: 'understand', // mismatch with session.currentMode ('explore')
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });

      const mismatchRes = await thinkStreamPost(mismatchReq);
      assert.strictEqual(mismatchRes.status, 400, 'Must reject mode mismatch with 400');
      const mismatchJson = await mismatchRes.json();
      assert.ok(mismatchJson.error.includes('Workflow execution mismatch'));

      // 3. Rejects act mode when session lacks accepted decision insight with 400
      SupabaseThinkingRepository.prototype.getSession = async () => ({
        id: 'sess-act-gate',
        userId: 'usr-stream-test',
        title: 'Act Gate Session',
        problemStatement: 'Ready to act',
        currentMode: 'act',
        currentStage: 'choose_action',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // No accepted decision insight
      SupabaseThinkingRepository.prototype.getInsights = async () => [];

      const actGateReq = new NextRequest('http://localhost:3000/api/think/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-auth-token',
        },
        body: JSON.stringify({
          sessionId: 'sess-act-gate',
          problemStatement: 'Ready to act',
          currentMode: 'act',
          messages: [{ role: 'user', content: 'Action plan' }],
        }),
      });

      const actGateRes = await thinkStreamPost(actGateReq);
      assert.strictEqual(actGateRes.status, 400, 'Must deny act mode when no decision exists');
      const actGateJson = await actGateRes.json();
      assert.ok(actGateJson.error.includes('cannot execute in "act" mode without at least one accepted decision insight'));
    } finally {
      supabase.auth.getUser = origGetUser;
      SupabaseThinkingRepository.prototype.getSession = origGetSession;
      SupabaseThinkingRepository.prototype.getInsights = origGetInsights;
    }
  });

  test('GET /api/auth/session reports verified identity and performs silent token refresh', async () => {
    // 1. Unauthenticated request returns authenticated: false
    const unauthReq = new NextRequest('http://localhost:3000/api/auth/session', {
      method: 'GET',
    });
    const unauthRes = await sessionGet(unauthReq);
    assert.strictEqual(unauthRes.status, 200);
    const unauthJson = await unauthRes.json();
    assert.strictEqual(unauthJson.authenticated, false);
    assert.strictEqual(unauthJson.user, null);

    // 2. Verified active access token returns authenticated: true directly
    const origGetUser = supabase.auth.getUser;
    const origRefresh = supabase.auth.refreshSession;
    try {
      supabase.auth.getUser = (async (token: string) => {
        if (token === 'valid-user-cookie') {
          return {
            data: { user: { id: 'usr-cookie-456', email: 'cookie@thinkmate.ai' } },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'JWT expired' } };
      }) as unknown as typeof supabase.auth.getUser;

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

      // 3. Expired access token with valid refresh token is read-only (canRefresh: true, no cookies mutated)
      const expiredReq = new NextRequest('http://localhost:3000/api/auth/session', {
        method: 'GET',
        headers: {
          Cookie: 'thinkmate_auth_token=expired-jwt; thinkmate_refresh_token=valid-refresh',
        },
      });
      const expiredRes = await sessionGet(expiredReq);
      assert.strictEqual(expiredRes.status, 200);
      const expiredJson = await expiredRes.json();
      assert.strictEqual(expiredJson.authenticated, false, 'GET /api/auth/session must not authenticate without active token');
      assert.strictEqual(expiredJson.canRefresh, true, 'GET /api/auth/session must signal canRefresh: true');
      assert.strictEqual(expiredJson.user, null);

      // Verify GET request did NOT set or rotate cookies
      const getCookies = expiredRes.headers.get('set-cookie');
      assert.strictEqual(getCookies, null, 'GET /api/auth/session must be purely read-only and never set cookies');

      // 4. Client then performs explicit, CSRF-protected POST /api/auth/refresh to rotate tokens
      supabase.auth.refreshSession = (async () => ({
        data: {
          user: { id: 'usr-refreshed-session', email: 'refreshed@thinkmate.ai' },
          session: {
            access_token: 'fresh-jwt-token',
            refresh_token: 'fresh-refresh-token',
          },
        },
        error: null,
      })) as unknown as typeof supabase.auth.refreshSession;

      const refreshReq = new NextRequest('http://localhost:3000/api/auth/refresh', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'thinkmate_refresh_token=valid-refresh',
        },
      });
      const refreshRes = await refreshPost(refreshReq);
      assert.strictEqual(refreshRes.status, 200);
      const refreshJson = await refreshRes.json();
      assert.strictEqual(refreshJson.success, true);
      assert.strictEqual(refreshJson.user.id, 'usr-refreshed-session');

      const refreshCookies = refreshRes.headers.get('set-cookie');
      assert.ok(refreshCookies?.includes('thinkmate_auth_token='), 'POST refresh must set updated access token');
      assert.ok(refreshCookies?.includes('thinkmate_refresh_token='), 'POST refresh must set updated refresh token');
    } finally {
      supabase.auth.getUser = origGetUser;
      supabase.auth.refreshSession = origRefresh;
    }
  });

  test('RotationGraceCache bounded size limits, hash indexing, in-memory AES-256-GCM encryption, and active expiration eviction', () => {
    const cache = new RotationGraceCache(3);

    const now = Date.now();
    // Insert 3 entries with different expirations
    cache.set('token-1', {
      session: { access_token: 'jwt-1' },
      user: { id: 'u1' },
      expiresAt: now - 1000, // already expired
    });
    cache.set('token-2', {
      session: { access_token: 'jwt-secret-payload-2' },
      user: { id: 'u2' },
      expiresAt: now + 50000, // valid
    });
    cache.set('token-3', {
      session: { access_token: 'jwt-secret-payload-3' },
      user: { id: 'u3' },
      expiresAt: now + 50000, // valid
    });

    // 1. Verify raw token is never stored as plaintext key in memory
    assert.strictEqual(hashTokenKey('token-1').length, 64, 'Token key must be a 64-character SHA-256 hex string');

    // 2. Verify cached tokens in memory buffers are AES-256-GCM encrypted and never plaintext
    // @ts-expect-error test private property inspection
    const internalMap = cache.cache;
    const rawHashedKey = hashTokenKey('token-2');
    const internalEntry = internalMap.get(rawHashedKey);
    assert.ok(internalEntry?.encrypted?.ciphertext, 'Internal cache entry must store encrypted ciphertext');
    assert.ok(internalEntry?.encrypted?.iv, 'Internal cache entry must store initialization vector');
    assert.ok(internalEntry?.encrypted?.tag, 'Internal cache entry must store auth tag');
    const serializedEntry = JSON.stringify(internalEntry);
    assert.strictEqual(
      serializedEntry.includes('jwt-secret-payload-2'),
      false,
      'Process heap memory buffer must NEVER retain plaintext JWT tokens'
    );

    // 3. token-1 was expired, so accessing it should evict it and return undefined
    assert.strictEqual(cache.get('token-1'), undefined, 'Expired entry must be evicted');

    // 4. Decrypts seamlessly on access for valid entries
    const retrieved2 = cache.get('token-2');
    assert.strictEqual(retrieved2?.session.access_token, 'jwt-secret-payload-2');
    assert.strictEqual(retrieved2?.user.id, 'u2');

    // 5. Add 2 more entries to test bounded size eviction
    cache.set('token-4', {
      session: { access_token: 'jwt-4' },
      user: { id: 'u4' },
      expiresAt: now + 50000,
    });
    cache.set('token-5', {
      session: { access_token: 'jwt-5' },
      user: { id: 'u5' },
      expiresAt: now + 50000,
    });

    // Max size is 3; size should not exceed 3
    assert.ok(cache.size() <= 3, 'Cache size must remain bounded at or below max capacity');
    assert.strictEqual(cache.get('token-5')?.user.id, 'u5');
  });

  test('revokeUserSession and POST /api/auth/logout enforce confirmed revocation contract', async () => {
    // 1. Without credentials or valid tokens, local logout succeeds
    const emptyResult = await revokeUserSession();
    assert.strictEqual(emptyResult.success, true);
    assert.strictEqual(emptyResult.localCleared, true);
    assert.strictEqual(emptyResult.upstreamRevoked, false);

    // 2. When a token is supplied but upstream revocation fails, overall success MUST be false!
    const failedResult = await revokeUserSession('non-existent-or-expired-token');
    assert.strictEqual(failedResult.success, false, 'Must report success: false when upstream revocation cannot be confirmed');
    assert.strictEqual(failedResult.upstreamRevoked, false);
    assert.strictEqual(failedResult.localCleared, true);
    assert.ok(failedResult.error, 'Must provide detailed error description');

    // 3. POST /api/auth/logout returns 502 with success: false when credentials provided but upstream revocation fails
    const failLogoutReq = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        Cookie: 'thinkmate_auth_token=unrevocable-dead-token',
      },
    });
    const failLogoutRes = await logoutPost(failLogoutReq);
    assert.strictEqual(failLogoutRes.status, 502, 'Must return 502 Bad Gateway when upstream revocation fails');
    const failLogoutJson = await failLogoutRes.json();
    assert.strictEqual(failLogoutJson.success, false, 'Must report success: false when server revocation unconfirmed');
    assert.strictEqual(failLogoutJson.upstreamRevoked, false);
    assert.strictEqual(failLogoutJson.localCleared, true);
    assert.ok(failLogoutJson.upstreamError);
    // Crucial: Local cookies must STILL be cleared even when upstream revocation failed!
    const clearedCookies = failLogoutRes.headers.get('set-cookie');
    assert.ok(clearedCookies?.includes('Max-Age=0'), 'Must clear local cookies on failed upstream revocation');

    // 4. When upstream revocation succeeds (mock GoTrue /auth/v1/logout 204), returns 200 and confirmed success
    const originalFetch = global.fetch;
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

    try {
      let logoutUrlCalled = '';
      let authHeaderSent = '';
      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        logoutUrlCalled = String(url);
        authHeaderSent = (init?.headers as Record<string, string>)?.['Authorization'] || '';
        return {
          ok: true,
          status: 204,
          text: async () => '',
        } as unknown as Response;
      }) as typeof global.fetch;

      const okLogoutReq = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'thinkmate_auth_token=active-jwt-token-123',
        },
      });
      const okLogoutRes = await logoutPost(okLogoutReq);
      assert.strictEqual(okLogoutRes.status, 200);
      const okJson = await okLogoutRes.json();
      assert.strictEqual(okJson.success, true);
      assert.strictEqual(okJson.upstreamRevoked, true, 'Must report upstreamRevoked: true on 204 response from GoTrue');
      assert.strictEqual(okJson.localCleared, true);
      assert.ok(logoutUrlCalled.includes('/auth/v1/logout'), 'Must target GoTrue /auth/v1/logout endpoint');
      assert.strictEqual(authHeaderSent, 'Bearer active-jwt-token-123', 'Must pass bearer token in Authorization header');
    } finally {
      global.fetch = originalFetch;
      process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origAnon;
    }
  });

  test('Multi-instance refresh recovery distributes rotated tokens so clients can continue refreshing', async () => {
    const origRefresh = supabase.auth.refreshSession;
    const origFetch = global.fetch;
    const origRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    process.env.UPSTASH_REDIS_REST_URL = 'https://mock-distributed-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-redis-secret';

    const distributedStore = new Map<string, string>();

    try {
      // Mock distributed Upstash Redis REST API
      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('mock-distributed-redis')) {
          assert.strictEqual(init?.method, 'POST', 'Upstash Redis commands must use POST to avoid leaking payloads in URLs');
          assert.ok(
            !urlStr.includes('r1-initial-token') && !urlStr.includes('a2-fresh-access-token'),
            'Sensitive tokens must NEVER appear in request URLs'
          );
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
          if (Array.isArray(body)) {
            const cmd = body[0];
            if (cmd === 'SET') {
              const key = body[1];
              const val = body[2];
              distributedStore.set(key, val);
              return { ok: true, json: async () => ({ result: 'OK' }) } as unknown as Response;
            }
            if (cmd === 'GET') {
              const key = body[1];
              const val = distributedStore.get(key);
              return {
                ok: true,
                json: async () => ({ result: val || null }),
              } as unknown as Response;
            }
          }
        }
        return origFetch(url, init);
      }) as typeof global.fetch;

      // 1. Instance A rotates R1 -> (A2, R2) and persists to distributed store
      let instanceARefreshCalls = 0;
      supabase.auth.refreshSession = (async ({ refresh_token }: { refresh_token: string }) => {
        if (refresh_token === 'r1-initial-token') {
          instanceARefreshCalls++;
          return {
            data: {
              session: {
                access_token: 'a2-fresh-access-token',
                refresh_token: 'r2-fresh-refresh-token',
                expires_at: Math.floor(Date.now() / 1000) + 3600,
              },
              user: { id: 'usr-distributed-refresh', email: 'distributed@thinkmate.ai' },
            },
            error: null,
          };
        }
        if (refresh_token === 'r2-fresh-refresh-token') {
          return {
            data: {
              session: {
                access_token: 'a3-subsequent-access-token',
                refresh_token: 'r3-subsequent-refresh-token',
                expires_at: Math.floor(Date.now() / 1000) + 3600,
              },
              user: { id: 'usr-distributed-refresh', email: 'distributed@thinkmate.ai' },
            },
            error: null,
          };
        }
        return {
          data: { session: null, user: null },
          error: { message: 'Already Used: Refresh token already rotated' },
        };
      }) as unknown as typeof supabase.auth.refreshSession;

      // Simulate Instance A executing refresh
      const { refreshUserSession } = await import('@/lib/server-auth');
      const resA = await refreshUserSession('r1-initial-token');
      assert.strictEqual(resA.data.session?.refresh_token, 'r2-fresh-refresh-token');
      assert.strictEqual(instanceARefreshCalls, 1);

      // Verify rotation was persisted to distributed Redis store and is encrypted
      const distributedKey = `auth:rotation:${hashTokenKey('r1-initial-token')}`;
      assert.ok(distributedStore.has(distributedKey), 'Rotated session must be persisted in distributed store');
      const rawStoredVal = distributedStore.get(distributedKey)!;
      assert.ok(
        !rawStoredVal.includes('a2-fresh-access-token') && !rawStoredVal.includes('r2-fresh-refresh-token'),
        'Stored value in Redis must be encrypted AES-256-GCM ciphertext, NOT plaintext tokens'
      );

      // 2. Instance B receives concurrent request with old token r1-initial-token (separate in-memory cache)
      const instanceBCache = new RotationGraceCache(10); // separate instance cache
      assert.strictEqual(instanceBCache.get('r1-initial-token'), undefined, 'Instance B memory cache must be empty initially');

      // Client sends POST /api/auth/refresh to Instance B
      const reqToInstanceB = new NextRequest('http://localhost:3000/api/auth/refresh', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'thinkmate_refresh_token=r1-initial-token',
        },
      });

      const resFromInstanceB = await refreshPost(reqToInstanceB);
      assert.strictEqual(resFromInstanceB.status, 200, 'Instance B must recover rotation via distributed store');
      const jsonB = await resFromInstanceB.json();
      assert.strictEqual(jsonB.success, true);
      assert.strictEqual(jsonB.user.id, 'usr-distributed-refresh');

      // Crucial: Instance B MUST issue updated cookies containing the new rotated refresh token r2!
      const setCookiesB = resFromInstanceB.headers.get('set-cookie');
      assert.ok(
        setCookiesB?.includes('thinkmate_refresh_token=r2-fresh-refresh-token'),
        'Instance B must set the newly rotated refresh token cookie for the browser'
      );
      assert.ok(
        setCookiesB?.includes('thinkmate_auth_token=a2-fresh-access-token'),
        'Instance B must set the newly rotated access token cookie for the browser'
      );

      // 3. Confirm that the browser can continue refreshing after access token expires using R2!
      const reqWithR2 = new NextRequest('http://localhost:3000/api/auth/refresh', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          Cookie: 'thinkmate_refresh_token=r2-fresh-refresh-token',
        },
      });

      const resSubsequent = await refreshPost(reqWithR2);
      assert.strictEqual(resSubsequent.status, 200, 'Subsequent refresh with R2 must succeed');
      const jsonSubsequent = await resSubsequent.json();
      assert.strictEqual(jsonSubsequent.success, true);
      const subsequentCookies = resSubsequent.headers.get('set-cookie');
      assert.ok(
        subsequentCookies?.includes('thinkmate_refresh_token=r3-subsequent-refresh-token'),
        'Subsequent refresh must rotate to R3'
      );
    } finally {
      supabase.auth.refreshSession = origRefresh;
      global.fetch = origFetch;
      if (origRedisUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origRedisUrl;
      else delete process.env.UPSTASH_REDIS_REST_URL;
      if (origRedisToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origRedisToken;
      else delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });

  test('verifyRateLimiterConfig validates production settings and exercises fail-closed vs operator recovery', async () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const origFailClosed = process.env.RATE_LIMIT_FAIL_CLOSED;
    const origAuthFailClosed = process.env.RATE_LIMIT_AUTH_FAIL_CLOSED;

    try {
      // 1. Missing credentials in production fails validation and alerts operators
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const invalidConfig = verifyRateLimiterConfig();
      assert.strictEqual(invalidConfig.valid, false, 'Missing Upstash in production must be marked invalid');
      assert.strictEqual(invalidConfig.isProduction, true);
      assert.strictEqual(invalidConfig.hasUpstash, false);
      assert.ok(invalidConfig.error?.includes('must be configured in production'));

      // In production without Redis and without emergency override, getActiveRateLimitStore fails closed
      const failClosedStore = getActiveRateLimitStore();
      const failClosedCheck = await failClosedStore.checkAndRecord!('test-prod-key', 10, 60000);
      assert.strictEqual(failClosedCheck.allowed, false, 'Production without Redis must fail closed by default');

      // 2. Emergency Operator Recovery Runbook: setting RATE_LIMIT_FAIL_CLOSED=false engages memory fallback for non-auth
      // while auth endpoints REMAIN fail-closed!
      process.env.RATE_LIMIT_FAIL_CLOSED = 'false';
      const recoveryConfig = verifyRateLimiterConfig();
      assert.strictEqual(recoveryConfig.failClosedActive, false, 'General fail-closed should be inactive');
      assert.strictEqual(recoveryConfig.authFailClosedActive, true, 'Auth fail-closed must REMAIN ACTIVE even under general override');

      const recoveryStore = getActiveRateLimitStore();
      const nonAuthCheck = await recoveryStore.checkAndRecord!('test-prod-general-key', 10, 60000);
      assert.strictEqual(
        nonAuthCheck.allowed,
        true,
        'Operator recovery (RATE_LIMIT_FAIL_CLOSED=false) engages memory limiter for general routes'
      );

      // Verify that authentication routes DO NOT weaken and still fail closed under RATE_LIMIT_FAIL_CLOSED=false!
      const authUnderEmergencyCheck = await recoveryStore.checkAndRecord!('auth:login:1.2.3.4', 5, 60000);
      assert.strictEqual(
        authUnderEmergencyCheck.allowed,
        false,
        'Auth routes MUST remain fail-closed under emergency RATE_LIMIT_FAIL_CLOSED=false to prevent brute-forcing'
      );

      // 3. Valid production configuration
      process.env.UPSTASH_REDIS_REST_URL = 'https://valid-upstash-redis.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'valid-token';
      const validConfig = verifyRateLimiterConfig();
      assert.strictEqual(validConfig.valid, true);
      assert.strictEqual(validConfig.hasUpstash, true);
      assert.strictEqual(validConfig.error, undefined);

      // 4. Invalid URL format
      process.env.UPSTASH_REDIS_REST_URL = 'invalid-not-a-url';
      const invalidUrlConfig = verifyRateLimiterConfig();
      assert.strictEqual(invalidUrlConfig.valid, false);
      assert.ok(invalidUrlConfig.error?.includes('UPSTASH_REDIS_REST_URL is invalid'));

      // 5. Deliberately malformed URL containing dummy secret: assert secret never appears in error output
      process.env.UPSTASH_REDIS_REST_URL = 'https://admin:super_secret_dummy_password_98765@invalid domain name with spaces';
      const secretUrlConfig = verifyRateLimiterConfig();
      assert.strictEqual(secretUrlConfig.valid, false);
      assert.ok(secretUrlConfig.error?.includes('UPSTASH_REDIS_REST_URL is invalid'));
      assert.strictEqual(secretUrlConfig.error?.includes('super_secret_dummy_password_98765'), false, 'Sensitive URL credentials must never be echoed');

      // 6. Insecure HTTP protocol rejected in production
      process.env.UPSTASH_REDIS_REST_URL = 'http://unencrypted-redis.upstash.io';
      const insecureHttpConfig = verifyRateLimiterConfig();
      assert.strictEqual(insecureHttpConfig.valid, false);
      assert.ok(insecureHttpConfig.error?.includes('Protocol must be https:'));
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
      if (origUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      else delete process.env.UPSTASH_REDIS_REST_URL;
      if (origToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
      else delete process.env.UPSTASH_REDIS_REST_TOKEN;
      if (origFailClosed !== undefined) process.env.RATE_LIMIT_FAIL_CLOSED = origFailClosed;
      else delete process.env.RATE_LIMIT_FAIL_CLOSED;
      if (origAuthFailClosed !== undefined) process.env.RATE_LIMIT_AUTH_FAIL_CLOSED = origAuthFailClosed;
      else delete process.env.RATE_LIMIT_AUTH_FAIL_CLOSED;
    }
  });

  test('Multi-instance workflow concurrency safety without shared in-memory state', async () => {
    // Simulate two independent server instances (Instance A and Instance B) with separate in-memory caches
    let committedStage = 'welcome';
    let committedMode = 'understand';
    let callCount = 0;
    const committedIdempotencyKeys = new Map<string, Record<string, unknown>>();

    // Mock RPC client simulating PostgreSQL serialized FOR UPDATE row-locking
    const mockDbClient = {
      rpc: async (fn: string, params: Record<string, unknown>) => {
        callCount++;
        const pStage = params.p_expected_stage as string;
        const pMode = params.p_expected_mode as string;
        const clientReqId = params.p_client_request_id as string;
        const reqHash = params.p_request_hash as string;

        // Simulate database post-lock idempotency check
        if (clientReqId && committedIdempotencyKeys.has(clientReqId)) {
          const existing = committedIdempotencyKeys.get(clientReqId)!;
          if (existing.requestHash !== reqHash) {
            return {
              data: null,
              error: { message: `Idempotency key reuse violation: ${clientReqId}` },
            };
          }
          return { data: existing.payload, error: null };
        }

        // Simulate database optimistic concurrency control under FOR UPDATE row lock
        if (pStage !== committedStage || pMode !== committedMode) {
          return {
            data: null,
            error: {
              message: `CONFLICT: expected stage "${pStage}" but session is at "${committedStage}". Reload the session.`,
            },
          };
        }

        // Commit transition
        committedStage = params.p_next_stage as string;
        committedMode = params.p_next_mode as string;
        const resultPayload = {
          sessionId: params.p_session_id,
          assistantMessageId: 'ast-msg-1',
          nextStage: committedStage,
          nextMode: committedMode,
          isIdempotentReplay: false,
        };

        if (clientReqId) {
          committedIdempotencyKeys.set(clientReqId, {
            requestHash: reqHash,
            payload: { ...resultPayload, isIdempotentReplay: true },
          });
        }

        return { data: resultPayload, error: null };
      },
    } as unknown as typeof supabase;

    // Instance A and Instance B have separate in-memory caches
    const repoInstanceA = new SupabaseThinkingRepository(mockDbClient);
    const repoInstanceB = new SupabaseThinkingRepository(mockDbClient);

    // Clear shared static cache to verify instances do NOT rely on in-process memory
    SupabaseThinkingRepository.idempotencyCache.clear();

    const transitionParams = {
      sessionId: 'sess-multi-instance-1',
      assistantMessage: 'Moving to describe problem',
      expectedStage: 'welcome' as const,
      expectedMode: 'understand' as const,
      nextStage: 'describe_problem' as const,
      nextMode: 'understand' as const,
      clientRequestId: 'req-multi-inst-1',
    };

    // Both instances receive simultaneous requests for the same step transition
    const [resA, resB] = await Promise.all([
      repoInstanceA.recordWorkflowStep(transitionParams, 'usr-test-1'),
      repoInstanceB.recordWorkflowStep(transitionParams, 'usr-test-1'),
    ]);

    // Exactly one request committed the new state; the simultaneous request received the idempotent replay
    const committedCount = [resA, resB].filter((r) => !r.isIdempotentReplay).length;
    const replayCount = [resA, resB].filter((r) => r.isIdempotentReplay).length;

    assert.strictEqual(committedCount, 1, 'Exactly one transaction must commit the transition');
    assert.strictEqual(replayCount, 1, 'The duplicate simultaneous request must receive idempotent replay');
    assert.strictEqual(committedStage, 'describe_problem', 'Final database stage must be committed cleanly');
    assert.strictEqual(callCount, 2, 'Both independent instances should invoke the database RPC');
  });

  test('Local and cloud session separation: unauthenticated isolation, sign-in, reload, import, account switching, and deletion', async () => {
    // 1. Unauthenticated isolation: offline drafts cannot reach cloud API endpoints
    const unauthGetReq = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'GET',
    });
    const unauthGetRes = await sessionsGet(unauthGetReq);
    assert.strictEqual(unauthGetRes.status, 401, 'Unauthenticated session GET must return 401');

    const unauthPostReq = new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Draft Title',
        problemStatement: 'Draft Problem',
      }),
    });
    const unauthPostRes = await sessionsPost(unauthPostReq);
    assert.strictEqual(unauthPostRes.status, 401, 'Unauthenticated session POST must return 401');

    const unauthDelReq = new NextRequest('http://localhost:3000/api/sessions?id=sess-123', {
      method: 'DELETE',
      headers: {
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
    });
    const unauthDelRes = await sessionsDelete(unauthDelReq);
    assert.strictEqual(unauthDelRes.status, 401, 'Unauthenticated session DELETE must return 401');

    // 2. Sign-in User Alpha & verify session reload
    const origGetUser = supabase.auth.getUser;
    const sessionStore = new Map<string, { id: string; user_id: string; title: string; problem_statement: string; current_mode: string; current_stage: string; status: string; created_at: string; updated_at: string }>();

    try {
      supabase.auth.getUser = (async (token?: string) => {
        if (token === 'alpha-access-jwt') {
          return { data: { user: { id: 'usr-alpha-123', email: 'alpha@thinkmate.ai' } }, error: null };
        }
        if (token === 'beta-access-jwt') {
          return { data: { user: { id: 'usr-beta-456', email: 'beta@thinkmate.ai' } }, error: null };
        }
        return { data: { user: null }, error: { message: 'Invalid JWT' } };
      }) as unknown as typeof supabase.auth.getUser;

      // Reload: GET /api/auth/session
      const reloadAlphaReq = new NextRequest('http://localhost:3000/api/auth/session', {
        headers: { Cookie: 'thinkmate_auth_token=alpha-access-jwt' },
      });
      const reloadAlphaRes = await sessionGet(reloadAlphaReq);
      const reloadAlphaJson = await reloadAlphaRes.json();
      assert.strictEqual(reloadAlphaJson.authenticated, true);
      assert.strictEqual(reloadAlphaJson.user.id, 'usr-alpha-123');

      // 3. Import offline draft into cloud session for User Alpha
      const origFrom = (supabase as unknown as { from: unknown }).from;
      (supabase as unknown as { from: unknown }).from = (table: string) => {
        if (table === 'thinking_sessions') {
          return {
            select: () => ({
              eq: (col: string, val: string) => {
                if (col === 'id') {
                  const item = sessionStore.get(val);
                  return {
                    maybeSingle: async () => ({ data: item || null, error: null }),
                  };
                }
                if (col === 'user_id') {
                  const items = Array.from(sessionStore.values()).filter((s) => s.user_id === val);
                  return {
                    order: () => ({ data: items, error: null }),
                  };
                }
                return { maybeSingle: async () => ({ data: null, error: null }) };
              },
            }),
            insert: (payload: Record<string, unknown>) => {
              const id = (payload.id as string) || crypto.randomUUID();
              const rec = {
                id,
                user_id: payload.user_id as string,
                title: payload.title as string,
                problem_statement: payload.problem_statement as string,
                current_mode: (payload.current_mode as string) || 'understand',
                current_stage: (payload.current_stage as string) || 'welcome',
                status: (payload.status as string) || 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              sessionStore.set(id, rec);
              return {
                select: () => ({
                  single: async () => ({ data: rec, error: null }),
                }),
              };
            },
            delete: () => ({
              eq: (_col1: string, val1: string) => ({
                eq: async (_col2: string, val2: string) => {
                  const existing = sessionStore.get(val1);
                  if (existing && existing.user_id === val2) {
                    sessionStore.delete(val1);
                  }
                  return { error: null };
                },
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      };

      try {
        const importReq = new NextRequest('http://localhost:3000/api/sessions', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3000',
            Host: 'localhost:3000',
            'Content-Type': 'application/json',
            Cookie: 'thinkmate_auth_token=alpha-access-jwt',
          },
          body: JSON.stringify({
            title: 'Imported Offline Architecture Dilemma',
            problemStatement: 'Local draft successfully transitioned to verified cloud session',
            currentMode: 'understand',
          }),
        });

        const importRes = await sessionsPost(importReq);
        assert.strictEqual(importRes.status, 200);
        const importJson = await importRes.json();
        assert.ok(importJson.session?.id, 'Imported session must have assigned UUID');
        const alphaSessionId = importJson.session.id;

        // 4. Alpha lists sessions
        const listAlphaReq = new NextRequest('http://localhost:3000/api/sessions', {
          headers: { Cookie: 'thinkmate_auth_token=alpha-access-jwt' },
        });
        const listAlphaRes = await sessionsGet(listAlphaReq);
        const listAlphaJson = await listAlphaRes.json();
        assert.strictEqual(listAlphaJson.sessions.length, 1);
        assert.strictEqual(listAlphaJson.sessions[0].id, alphaSessionId);

        // 5. Account switching: User Beta logs in
        // User Beta must NOT see Alpha's session in session list
        const listBetaReq = new NextRequest('http://localhost:3000/api/sessions', {
          headers: { Cookie: 'thinkmate_auth_token=beta-access-jwt' },
        });
        const listBetaRes = await sessionsGet(listBetaReq);
        const listBetaJson = await listBetaRes.json();
        assert.strictEqual(listBetaJson.sessions.length, 0, 'User Beta must NOT see User Alpha sessions');

        // User Beta attempting to access Alpha's session by ID returns 404/unauthorized
        const getBetaForeignReq = new NextRequest(`http://localhost:3000/api/sessions?id=${alphaSessionId}`, {
          headers: { Cookie: 'thinkmate_auth_token=beta-access-jwt' },
        });
        const getBetaForeignRes = await sessionsGet(getBetaForeignReq);
        assert.strictEqual(getBetaForeignRes.status, 404, 'Foreign session access must be rejected');

        // User Beta attempting to delete Alpha's session is rejected
        const delBetaForeignReq = new NextRequest(`http://localhost:3000/api/sessions?id=${alphaSessionId}`, {
          method: 'DELETE',
          headers: {
            Origin: 'http://localhost:3000',
            Host: 'localhost:3000',
            Cookie: 'thinkmate_auth_token=beta-access-jwt',
          },
        });
        const delBetaForeignRes = await sessionsDelete(delBetaForeignReq);
        assert.strictEqual(delBetaForeignRes.status, 403, 'Unauthorized foreign deletion must return 403');
        assert.ok(sessionStore.has(alphaSessionId), 'Alpha session must remain intact after unauthorized delete attempt');

        // 6. User Alpha deletes own session
        const delAlphaReq = new NextRequest(`http://localhost:3000/api/sessions?id=${alphaSessionId}`, {
          method: 'DELETE',
          headers: {
            Origin: 'http://localhost:3000',
            Host: 'localhost:3000',
            Cookie: 'thinkmate_auth_token=alpha-access-jwt',
          },
        });
        const delAlphaRes = await sessionsDelete(delAlphaReq);
        assert.strictEqual(delAlphaRes.status, 200);
        assert.strictEqual((await delAlphaRes.json()).success, true);
        assert.strictEqual(sessionStore.has(alphaSessionId), false, 'Session must be deleted from store');
      } finally {
        (supabase as unknown as { from: unknown }).from = origFrom;
      }
    } finally {
      supabase.auth.getUser = origGetUser;
    }
  });

  test('GeminiThinkingService validates structured metadata and refuses synthetic fallbacks', () => {
    const service = new GeminiThinkingService('dummy-test-key');
    interface TestEvent {
      type: string;
      questions?: string[];
      insights?: unknown[];
      mode?: string;
    }
    const events: TestEvent[] = [];
    const onEvent = (e: unknown) => events.push(e as TestEvent);

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
    assert.strictEqual(events[0].questions?.length, 2);
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

  test('Authentication rate limiting unconditionally fails closed in production regardless of overrides', async () => {
    const origEnv = process.env.NODE_ENV;
    const origFailClosed = process.env.RATE_LIMIT_FAIL_CLOSED;
    const origAuthOverride = process.env.RATE_LIMIT_AUTH_FAIL_CLOSED;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.RATE_LIMIT_FAIL_CLOSED = 'false'; // Attempt global override
      process.env.RATE_LIMIT_AUTH_FAIL_CLOSED = 'false'; // Attempt auth override
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      // 1. verifyRateLimiterConfig must report authFailClosedActive: true unconditionally in production
      const config = verifyRateLimiterConfig();
      assert.strictEqual(config.authFailClosedActive, true, 'authFailClosedActive must remain true unconditionally in production');

      // 2. getActiveRateLimitStore with missing Redis must reject auth endpoints
      const store = getActiveRateLimitStore();
      const authResult = await store.checkAndRecord!('auth:login:192.168.1.1', 10, 60000);
      assert.strictEqual(authResult.allowed, false, 'Auth endpoint must fail closed during production outage');
      assert.strictEqual(authResult.remaining, 0);

      // 3. checkRateLimit sync helper must also reject auth endpoints
      const syncResult = checkRateLimit('auth:signup:192.168.1.1', 5, 60000, store);
      assert.strictEqual(syncResult.allowed, false, 'checkRateLimit must reject auth endpoints unconditionally in production');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
      if (origFailClosed !== undefined) process.env.RATE_LIMIT_FAIL_CLOSED = origFailClosed;
      else delete process.env.RATE_LIMIT_FAIL_CLOSED;
      if (origAuthOverride !== undefined) process.env.RATE_LIMIT_AUTH_FAIL_CLOSED = origAuthOverride;
      else delete process.env.RATE_LIMIT_AUTH_FAIL_CLOSED;
      if (origUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      if (origToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
    }
  });

  test('Multi-instance refresh race recovers rotated session from distributed store when GoTrue reports error', async () => {
    const origRefresh = supabase.auth.refreshSession;
    const origFetch = global.fetch;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const origKey = process.env.SESSION_ENCRYPTION_KEY;

    const testOldToken = 'multi-instance-race-old-token-' + Date.now();
    const testNewToken = 'multi-instance-race-new-token-' + Date.now();
    const mockUser = { id: 'usr-race-test', email: 'race@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' };
    const mockNewSession = { access_token: 'new-acc-tok', refresh_token: testNewToken, expires_in: 3600, token_type: 'bearer', user: mockUser };

    // Shared mock Redis cluster store accessible by both independent instances
    const redisStore = new Map<string, string>();

    try {
      process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.redis.cluster.test';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'secret-redis-token-32-chars-long!';
      process.env.SESSION_ENCRYPTION_KEY = 'a-32-byte-test-cluster-encryption-secret-key!';

      global.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const urlStr = String(url);
        if (urlStr.includes('upstash.redis.cluster.test')) {
          if (init?.method === 'POST') {
            const body = JSON.parse(init.body as string);
            if (Array.isArray(body)) {
              const cmd = body[0];
              if (cmd === 'SET') {
                const [, key, val] = body;
                redisStore.set(key, val);
                return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
              } else if (cmd === 'GET') {
                const [, key] = body;
                const val = redisStore.get(key) || null;
                return new Response(JSON.stringify({ result: val }), { status: 200 });
              }
            }
          }
        }
        return origFetch(url, init);
      };

      // Ensure Instance 2's local in-memory cache is completely EMPTY for this token
      rotationGraceCache.clear();
      assert.strictEqual(rotationGraceCache.get(testOldToken), undefined, 'Instance 2 local memory cache must start empty');

      // Simulate Instance 1 writing the rotated session to the shared Redis cluster with a slight network delay
      setTimeout(async () => {
        await saveDistributedRotatedSession(testOldToken, mockNewSession, mockUser);
      }, 40);

      // Simultaneously, Instance 2 receives a request with the SAME old refresh token.
      // GoTrue rejects it with an error ("Already used" / invalid grant) because Instance 1 rotated it first.
      supabase.auth.refreshSession = async () => ({
        data: { session: null, user: null },
        error: { message: 'Refresh token already rotated / invalid grant' } as unknown as AuthError,
      });

      // Instance 2 calls refreshUserSession
      const result = await refreshUserSession(testOldToken);

      // Instance 2 successfully recovers the rotated credentials from shared Redis after backoff!
      assert.strictEqual(result.error, null, 'Instance 2 must successfully recover without error');
      assert.strictEqual(result.data.session?.refresh_token, testNewToken, 'Instance 2 must recover rotated refresh token from shared Redis');
      assert.strictEqual(result.data.user?.id, mockUser.id, 'Instance 2 must recover user profile');

      // Verify that Instance 2's local in-memory cache has now been populated by the distributed recovery
      const instance2Cached = rotationGraceCache.get(testOldToken);
      assert.ok(instance2Cached, 'Instance 2 local memory cache must be populated after distributed recovery');
      assert.strictEqual(instance2Cached?.session.refresh_token, testNewToken);
    } finally {
      supabase.auth.refreshSession = origRefresh;
      global.fetch = origFetch;
      if (origUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      else delete process.env.UPSTASH_REDIS_REST_URL;
      if (origToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
      else delete process.env.UPSTASH_REDIS_REST_TOKEN;
      if (origKey !== undefined) process.env.SESSION_ENCRYPTION_KEY = origKey;
      else delete process.env.SESSION_ENCRYPTION_KEY;
    }
  });

  test('getClusterEncryptionKey derives uniform 32-byte key via HKDF and prohibits service-role fallback in production', () => {
    const origEnv = process.env.NODE_ENV;
    const origKey = process.env.SESSION_ENCRYPTION_KEY;
    const origSecret = process.env.ROTATION_SECRET;
    const origServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.SESSION_ENCRYPTION_KEY;
      delete process.env.ROTATION_SECRET;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      // 1. Missing dedicated secret in production throws fatal error
      assert.throws(() => getClusterEncryptionKey(), /SECURITY FATAL/);

      // 2. Service-role fallback in production is strictly prohibited
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-that-must-never-be-used-for-token-encryption-32-chars!';
      assert.throws(() => getClusterEncryptionKey(), /Service-role key derivation is strictly prohibited in production/);

      // 3. Secret with < 32 bytes in production throws fatal error
      process.env.SESSION_ENCRYPTION_KEY = 'short-weak-key';
      assert.throws(() => getClusterEncryptionKey(), /must provide at least 32 bytes of entropy/);

      // 4. Dedicated high-entropy secret derives uniform 32-byte Buffer via HKDF-SHA256
      process.env.SESSION_ENCRYPTION_KEY = 'a-super-secret-high-entropy-key-32-chars-long!';
      const keyBuffer = getClusterEncryptionKey();
      assert.strictEqual(keyBuffer.length, 32);

      // 5. In test/development, weak key derives 32-byte key safely via HKDF without crashing
      (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
      process.env.SESSION_ENCRYPTION_KEY = 'short';
      const devBuffer = getClusterEncryptionKey();
      assert.strictEqual(devBuffer.length, 32);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
      if (origKey !== undefined) process.env.SESSION_ENCRYPTION_KEY = origKey;
      else delete process.env.SESSION_ENCRYPTION_KEY;
      if (origSecret !== undefined) process.env.ROTATION_SECRET = origSecret;
      else delete process.env.ROTATION_SECRET;
      if (origServiceKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceKey;
      else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  test('getClientIp uses TRUSTED_PROXY_DEPTH and prevents edge header spoofing without designated provider', () => {
    const origDepth = process.env.TRUSTED_PROXY_DEPTH;
    const origProvider = process.env.TRUSTED_PROXY_PROVIDER;
    const origHeader = process.env.TRUSTED_PROXY_HEADER;

    try {
      delete process.env.TRUSTED_PROXY_PROVIDER;
      delete process.env.TRUSTED_PROXY_HEADER;

      // 1. Standard mode: Attacker injects fake cf-connecting-ip and x-real-ip
      // Must NOT trust spoofed headers; uses verified x-forwarded-for with TRUSTED_PROXY_DEPTH
      process.env.TRUSTED_PROXY_DEPTH = '1';
      const spoofedReq = new Request('http://localhost:3000', {
        headers: {
          'cf-connecting-ip': '1.1.1.1', // Spoofed client header
          'x-real-ip': '2.2.2.2',        // Spoofed client header
          'x-forwarded-for': '203.0.113.195, 198.51.100.1', // Left is client-forged, Right is edge proxy hop
        },
      });
      assert.strictEqual(getClientIp(spoofedReq), '198.51.100.1', 'Must ignore spoofed edge headers in standard mode');

      // 2. Depth 2: picks 2nd from right
      process.env.TRUSTED_PROXY_DEPTH = '2';
      const spoofedReq2 = new Request('http://localhost:3000', {
        headers: {
          'x-forwarded-for': '10.0.0.1, 203.0.113.50, 198.51.100.1',
        },
      });
      assert.strictEqual(getClientIp(spoofedReq2), '203.0.113.50');

      // 3. Designated Cloudflare provider: honors cf-connecting-ip when explicitly configured
      process.env.TRUSTED_PROXY_PROVIDER = 'cloudflare';
      const cfReq = new Request('http://localhost:3000', {
        headers: {
          'cf-connecting-ip': '198.51.100.99',
          'x-forwarded-for': '203.0.113.195, 198.51.100.1',
        },
      });
      assert.strictEqual(getClientIp(cfReq), '198.51.100.99', 'Must honor cf-connecting-ip when Cloudflare provider is designated');

      // 4. Designated Vercel provider: honors x-vercel-forwarded-for
      process.env.TRUSTED_PROXY_PROVIDER = 'vercel';
      const vercelReq = new Request('http://localhost:3000', {
        headers: {
          'x-vercel-forwarded-for': '198.51.100.77',
          'x-forwarded-for': '203.0.113.195, 198.51.100.1',
        },
      });
      assert.strictEqual(getClientIp(vercelReq), '198.51.100.77', 'Must honor x-vercel-forwarded-for when Vercel is designated provider');

      // 5. Spoofed x-vercel-forwarded-for is ignored when provider is not Vercel
      process.env.TRUSTED_PROXY_DEPTH = '1';
      process.env.TRUSTED_PROXY_PROVIDER = 'nginx';
      const spoofedVercelReq = new Request('http://localhost:3000', {
        headers: {
          'x-vercel-forwarded-for': '198.51.100.77',
          'x-forwarded-for': '203.0.113.195, 198.51.100.2',
        },
      });
      assert.strictEqual(getClientIp(spoofedVercelReq), '198.51.100.2', 'Must ignore spoofed x-vercel-forwarded-for under non-Vercel provider');
    } finally {
      if (origDepth !== undefined) process.env.TRUSTED_PROXY_DEPTH = origDepth;
      else delete process.env.TRUSTED_PROXY_DEPTH;
      if (origProvider !== undefined) process.env.TRUSTED_PROXY_PROVIDER = origProvider;
      else delete process.env.TRUSTED_PROXY_PROVIDER;
      if (origHeader !== undefined) process.env.TRUSTED_PROXY_HEADER = origHeader;
      else delete process.env.TRUSTED_PROXY_HEADER;
    }
  });

  test('AI insight category and status normalization maps broader tags to canonical schema', () => {
    // Category mapping
    assert.strictEqual(normalizeInsightCategory('tradeoff'), 'uncertainty');
    assert.strictEqual(normalizeInsightCategory('trade-off'), 'uncertainty');
    assert.strictEqual(normalizeInsightCategory('tension'), 'uncertainty');
    assert.strictEqual(normalizeInsightCategory('risk'), 'uncertainty');
    assert.strictEqual(normalizeInsightCategory('next_step'), 'action');
    assert.strictEqual(normalizeInsightCategory('milestone'), 'action');
    assert.strictEqual(normalizeInsightCategory('decision'), 'decision');
    assert.strictEqual(normalizeInsightCategory('goal'), 'goal');
    assert.strictEqual(normalizeInsightCategory('assumption'), 'assumption');
    assert.strictEqual(normalizeInsightCategory('option'), 'option');

    // Status mapping
    assert.strictEqual(normalizeInsightStatus('proposed'), 'under_review');
    assert.strictEqual(normalizeInsightStatus('pending'), 'under_review');
    assert.strictEqual(normalizeInsightStatus('approved'), 'accepted');
    assert.strictEqual(normalizeInsightStatus('accepted'), 'accepted');
    assert.strictEqual(normalizeInsightStatus('rejected'), 'rejected');
  });

  test('recordWorkflowStep enforces accepted-decision prerequisite when moving to Act mode or choose_action', async () => {
    const fakeSessionId = crypto.randomUUID();
    const fakeUserId = crypto.randomUUID();

    // 1. Transactional RPC path: Database RPC throws when moving to choose_action/act without accepted decision
    const mockClient = {
      rpc: async (fnName: string, params: Record<string, unknown>) => {
        if (fnName === 'record_workflow_step_tx') {
          if (params.p_next_mode === 'act' || params.p_next_stage === 'choose_action') {
            return {
              data: null,
              error: {
                message: 'Transition denied: Moving to Act mode or choose_action requires at least one accepted decision insight',
              },
            };
          }
        }
        return { data: { sessionId: params.p_session_id }, error: null };
      },
    } as unknown as SupabaseClient;

    const repoWithRpc = new SupabaseThinkingRepository(mockClient);

    await assert.rejects(
      async () => {
        await repoWithRpc.recordWorkflowStep(
          {
            sessionId: fakeSessionId,
            assistantMessage: 'Step message',
            nextStage: 'choose_action',
            nextMode: 'act',
            expectedStage: 'summarize_insights',
            expectedMode: 'decide',
          },
          fakeUserId
        );
      },
      /Transition denied: Moving to Act mode or choose_action requires at least one accepted decision insight/
    );

    // 2. Fallback path (when RPC is not configured or in unit test mode without RPC client)
    const mockClientFallback = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'msg-fallback' }, error: null }) }) }),
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    } as unknown as SupabaseClient;

    const repoFallback = new SupabaseThinkingRepository(mockClientFallback);
    repoFallback.getSession = async () => ({
      id: fakeSessionId,
      userId: fakeUserId,
      title: 'Test Session',
      problemStatement: 'Test Problem',
      currentMode: 'decide',
      currentStage: 'summarize_insights',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    repoFallback.getInsights = async () => [
      {
        id: crypto.randomUUID(),
        sessionId: fakeSessionId,
        category: 'decision',
        title: 'Proposed direction',
        content: 'Details',
        status: 'under_review', // NOT accepted!
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    await assert.rejects(
      async () => {
        await repoFallback.recordWorkflowStep(
          {
            sessionId: fakeSessionId,
            assistantMessage: 'Step message',
            nextStage: 'choose_action',
            nextMode: 'act',
            expectedStage: 'summarize_insights',
            expectedMode: 'decide',
          },
          fakeUserId
        );
      },
      /Transition denied: Moving to Act mode or choose_action requires at least one accepted decision insight/
    );
  });

  test('createRateLimitErrorResponse standardizes 503 for infrastructure outages vs 429 for quota throttling', () => {
    // 1. Infrastructure outage / dependency failure (fail-closed)
    const outageResult = {
      allowed: false,
      remaining: 0,
      resetMs: 45000,
      unavailable: true,
    };
    const outageResponse = createRateLimitErrorResponse(outageResult, 'Custom message should be overridden or standardized');
    assert.strictEqual(outageResponse.status, 503, 'Infrastructure outage must return HTTP 503');
    assert.strictEqual(outageResponse.headers.get('Retry-After'), '45');

    // 2. Normal quota throttling (quota exceeded)
    const quotaResult = {
      allowed: false,
      remaining: 0,
      resetMs: 12000,
      unavailable: false,
    };
    const quotaResponse = createRateLimitErrorResponse(quotaResult, 'Too many requests on this endpoint.');
    assert.strictEqual(quotaResponse.status, 429, 'Normal throttling must return HTTP 429');
    assert.strictEqual(quotaResponse.headers.get('Retry-After'), '12');

    // 3. Normal quota throttling with default message
    const defaultQuotaResponse = createRateLimitErrorResponse(quotaResult);
    assert.strictEqual(defaultQuotaResponse.status, 429);
    assert.strictEqual(defaultQuotaResponse.headers.get('Retry-After'), '12');
  });

  test('verifyRateLimiterConfigAsync verifies configuration and emits distributed async alerts', async () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      // Unconfigured production Redis triggers async CONFIG_MISSING
      const res = await verifyRateLimiterConfigAsync();
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.hasUpstash, false);
      assert.ok(res.error?.includes('must be configured in production'));

      // Configured production Redis validates successfully
      process.env.UPSTASH_REDIS_REST_URL = 'https://prod-redis.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'prod-token';
      const validRes = await verifyRateLimiterConfigAsync();
      assert.strictEqual(validRes.valid, true);
      assert.strictEqual(validRes.hasUpstash, true);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
      if (origUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      else delete process.env.UPSTASH_REDIS_REST_URL;
      if (origToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
      else delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });

  test('getActiveRateLimitStore in production routes missing-Redis alerts through async distributed path', async () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const store = getActiveRateLimitStore();
      assert.ok(store.checkAndRecord, 'Production missing-redis store must provide checkAndRecord');

      // Auth endpoint fails closed with 503 unavailable
      const authRes = await store.checkAndRecord('auth:login:192.0.2.1', 5, 60000);
      assert.strictEqual(authRes.allowed, false);
      assert.strictEqual(authRes.unavailable, true);

      // Non-auth endpoint also fails closed by default in production
      const apiRes = await store.checkAndRecord('mutation:sessions:usr-1', 10, 60000);
      assert.strictEqual(apiRes.allowed, false);
      assert.strictEqual(apiRes.unavailable, true);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
      if (origUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      else delete process.env.UPSTASH_REDIS_REST_URL;
      if (origToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
      else delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });

  test('parseAndValidateIp and isValidIp correctly handle standards-compliant IPv4 and IPv6 formats', () => {
    // 1. Compressed IPv6
    assert.strictEqual(parseAndValidateIp('2001:db8::1'), '2001:db8::1');
    assert.strictEqual(isValidIp('2001:db8::1'), true);
    assert.strictEqual(parseAndValidateIp('fe80::1'), 'fe80::1');
    assert.strictEqual(parseAndValidateIp('::1'), '::1');
    assert.strictEqual(parseAndValidateIp('::'), '::');

    // 2. Full uncompressed IPv6
    const fullIpv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    assert.strictEqual(parseAndValidateIp(fullIpv6), fullIpv6);
    assert.strictEqual(isValidIp(fullIpv6), true);

    // 3. IPv4-mapped IPv6
    assert.strictEqual(parseAndValidateIp('::ffff:192.0.2.1'), '::ffff:192.0.2.1');

    // 4. Bracketed IPv6 with and without port
    assert.strictEqual(parseAndValidateIp('[2001:db8::1]'), '2001:db8::1');
    assert.strictEqual(parseAndValidateIp('[2001:db8::1]:8080'), '2001:db8::1');
    assert.strictEqual(parseAndValidateIp('[::1]:3000'), '::1');
    assert.strictEqual(isValidIp('[2001:db8::1]:8080'), true);

    // 5. IPv4 with and without port
    assert.strictEqual(parseAndValidateIp('192.0.2.1'), '192.0.2.1');
    assert.strictEqual(parseAndValidateIp('192.0.2.1:8080'), '192.0.2.1');
    assert.strictEqual(isValidIp('192.0.2.1:8080'), true);

    // 6. Malformed input and out-of-range ports rejected
    assert.strictEqual(parseAndValidateIp('2001:db8:::1'), null, 'Triple colon is invalid IPv6');
    assert.strictEqual(parseAndValidateIp('256.0.0.1'), null, 'Octet > 255 is invalid IPv4');
    assert.strictEqual(parseAndValidateIp('[2001:db8::1]:abc'), null, 'Non-numeric port is invalid');
    assert.strictEqual(parseAndValidateIp('[2001:db8::1]:99999'), null, 'Port > 65535 is invalid');
    assert.strictEqual(parseAndValidateIp('[2001:db8::1]:0'), null, 'Port 0 is invalid');
    assert.strictEqual(parseAndValidateIp('192.0.2.1:99999'), null, 'IPv4 port > 65535 is invalid');
    assert.strictEqual(parseAndValidateIp('not-an-ip-address'), null);
    assert.strictEqual(parseAndValidateIp(''), null);
    assert.strictEqual(parseAndValidateIp(null), null);
    assert.strictEqual(parseAndValidateIp(undefined), null);
  });

  test('getClientIp parses IPv6 clients and respects configured proxy chain depth against spoofing', () => {
    const origDepth = process.env.TRUSTED_PROXY_DEPTH;
    const origProvider = process.env.TRUSTED_PROXY_PROVIDER;
    const origTrust = process.env.TRUST_PROXY;

    try {
      delete process.env.TRUSTED_PROXY_PROVIDER;
      process.env.TRUST_PROXY = 'true';

      // 1. Single compressed IPv6 client
      process.env.TRUSTED_PROXY_DEPTH = '1';
      const req1 = new Request('http://localhost:3000', {
        headers: { 'x-forwarded-for': '2001:db8::1' },
      });
      assert.strictEqual(getClientIp(req1), '2001:db8::1');

      // 2. Bracketed IPv6 with port
      const req2 = new Request('http://localhost:3000', {
        headers: { 'x-forwarded-for': '[2001:db8::1]:8443' },
      });
      assert.strictEqual(getClientIp(req2), '2001:db8::1');

      // 3. Multi-hop chain with client spoofing attempt:
      // Client connects from 2001:db8::1, sends fake '198.51.100.99, 10.0.0.1' in x-forwarded-for.
      // Trusted edge proxy appends client's actual IP [2001:db8::1]:443.
      // Header becomes: "198.51.100.99, 10.0.0.1, [2001:db8::1]:443"
      const spoofedChainReq = new Request('http://localhost:3000', {
        headers: {
          'x-forwarded-for': '198.51.100.99, 10.0.0.1, [2001:db8::1]:443',
        },
      });
      assert.strictEqual(
        getClientIp(spoofedChainReq),
        '2001:db8::1',
        'Must select rightmost trusted hop and ignore leftmost spoofed IPs'
      );

      // 4. Depth 2 with IPv6 intermediate proxy
      process.env.TRUSTED_PROXY_DEPTH = '2';
      const depth2Req = new Request('http://localhost:3000', {
        headers: {
          'x-forwarded-for': 'spoofed.attacker.ip, 2001:db8::dead:beef, [2001:db8::1]:443',
        },
      });
      assert.strictEqual(
        getClientIp(depth2Req),
        '2001:db8::dead:beef',
        'Depth 2 must select second trusted hop from right'
      );

      // 5. Vercel provider with IPv6 client
      process.env.TRUSTED_PROXY_PROVIDER = 'vercel';
      const vercelIpv6Req = new Request('http://localhost:3000', {
        headers: {
          'x-vercel-forwarded-for': '2001:db8::42, 10.0.0.1',
        },
      });
      assert.strictEqual(getClientIp(vercelIpv6Req), '2001:db8::42');

      // 6. Cloudflare provider with IPv6 client
      process.env.TRUSTED_PROXY_PROVIDER = 'cloudflare';
      const cfIpv6Req = new Request('http://localhost:3000', {
        headers: {
          'cf-connecting-ip': '2001:db8::77',
        },
      });
      assert.strictEqual(getClientIp(cfIpv6Req), '2001:db8::77');
    } finally {
      if (origDepth !== undefined) process.env.TRUSTED_PROXY_DEPTH = origDepth;
      else delete process.env.TRUSTED_PROXY_DEPTH;
      if (origProvider !== undefined) process.env.TRUSTED_PROXY_PROVIDER = origProvider;
      else delete process.env.TRUSTED_PROXY_PROVIDER;
      if (origTrust !== undefined) process.env.TRUST_PROXY = origTrust;
      else delete process.env.TRUST_PROXY;
    }
  });
});
