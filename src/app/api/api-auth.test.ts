(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { POST as coThinkPost } from './cothink/route';
import { POST as thinkStreamPost } from './think/stream/route';
import { POST as workflowTransitionPost } from './workflow/transition/route';
import { POST as demoCoThinkPost } from './demo/cothink/route';
import { GET as healthGet } from './health/route';
import { checkRateLimitAsync, MemoryRateLimitStore } from '@/lib/rate-limiter';
import { WorkflowStateMachine } from '@/services/workflow/state-machine';
import { supabase } from '@/services/db/supabase-client';

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
});
