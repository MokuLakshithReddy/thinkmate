(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { POST as loginPost } from './auth/login/route';
import { POST as signupPost } from './auth/signup/route';
import { POST as refreshPost } from './auth/refresh/route';
import { supabase } from '@/services/db/supabase-client';
import { checkRateLimit } from '@/lib/rate-limiter';
import { hashTokenKey, rotationGraceCache, saveDistributedRotatedSession } from '@/lib/server-auth';

const ENV_KEYS = [
  'NODE_ENV',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'SESSION_ENCRYPTION_KEY',
  'RATE_LIMIT_FAIL_CLOSED',
  'TRUSTED_ORIGINS',
] as const;

const REDIS_URL = 'https://shared-redis.hardening.test';

/**
 * Minimal Upstash REST emulator shared by every simulated server instance.
 * Implements GET/SET and the sliding-window EVAL used by UpstashRedisRateLimitStore.
 */
function createSharedRedis() {
  const kv = new Map<string, string>();
  const zsets = new Map<string, number[]>();
  const evalKeys: string[] = [];
  const getCounts = new Map<string, number>();
  let hideGetsUntil = new Map<string, number>();
  let outage = false;

  const handler = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (!String(url).startsWith(REDIS_URL)) {
      throw new Error(`Unexpected outbound request in test: ${String(url)}`);
    }
    if (outage) {
      return new Response(JSON.stringify({ error: 'service unavailable' }), { status: 500 });
    }
    const body = JSON.parse(String(init?.body));
    const [cmd] = body;
    if (cmd === 'SET') {
      kv.set(body[1], body[2]);
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    }
    if (cmd === 'GET') {
      const key = body[1];
      const count = (getCounts.get(key) || 0) + 1;
      getCounts.set(key, count);
      const hiddenUntil = hideGetsUntil.get(key) || 0;
      const val = count <= hiddenUntil ? null : kv.get(key) ?? null;
      return new Response(JSON.stringify({ result: val }), { status: 200 });
    }
    if (cmd === 'EVAL') {
      const key = body[3];
      const now = Number(body[4]);
      const windowMs = Number(body[5]);
      const limit = Number(body[6]);
      evalKeys.push(key);
      const entries = (zsets.get(key) || []).filter((t) => t > now - windowMs);
      if (entries.length < limit) {
        entries.push(now);
        zsets.set(key, entries);
        return new Response(JSON.stringify({ result: [1, limit - entries.length, windowMs] }), { status: 200 });
      }
      zsets.set(key, entries);
      return new Response(JSON.stringify({ result: [0, 0, Math.max(0, windowMs - (now - entries[0]))] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `unsupported ${cmd}` }), { status: 400 });
  };

  return {
    handler: handler as typeof fetch,
    kv,
    zsets,
    evalKeys,
    getCounts,
    seedAttempts(key: string, count: number) {
      zsets.set(key, Array.from({ length: count }, () => Date.now()));
    },
    hideFirstGets(key: string, count: number) {
      hideGetsUntil = new Map(hideGetsUntil).set(key, count);
    },
    setOutage(value: boolean) {
      outage = value;
    },
  };
}

function credentialRequest(
  path: string,
  ip: string,
  overrides: { headers?: Record<string, string>; body?: string } = {}
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Host: 'localhost:3000',
      'x-forwarded-for': ip,
      ...overrides.headers,
    },
    body:
      overrides.body ??
      JSON.stringify({
        email: 'user@thinkmate.ai',
        password: 'correct-horse-battery',
        accepted_terms: true,
        age_confirmed: true,
      }),
  });
}

function refreshRequest(refreshToken: string, accessToken?: string) {
  return new NextRequest('http://localhost:3000/api/auth/refresh', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:3000',
      Host: 'localhost:3000',
      'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
      Cookie: [`thinkmate_refresh_token=${refreshToken}`, accessToken ? `thinkmate_auth_token=${accessToken}` : '']
        .filter(Boolean)
        .join('; '),
    },
  });
}

describe('Auth hardening: distributed rate limits, refresh recovery, credential CSRF', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const origFetch = global.fetch;
  const origSignIn = supabase.auth.signInWithPassword;
  const origSignUp = supabase.auth.signUp;
  const origRefresh = supabase.auth.refreshSession;
  const origGetUser = supabase.auth.getUser;
  let signInCalls = 0;
  let signUpCalls = 0;

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.SESSION_ENCRYPTION_KEY = 'hardening-test-cluster-encryption-secret-key-32b!';
    delete process.env.TRUSTED_ORIGINS;
    signInCalls = 0;
    signUpCalls = 0;
    supabase.auth.signInWithPassword = (async () => {
      signInCalls++;
      return {
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', name: 'AuthApiError', status: 400 },
      };
    }) as unknown as typeof supabase.auth.signInWithPassword;
    supabase.auth.signUp = (async () => {
      signUpCalls++;
      return { data: { user: { id: 'usr-new', email: 'user@thinkmate.ai' }, session: null }, error: null };
    }) as unknown as typeof supabase.auth.signUp;
    rotationGraceCache.clear();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete (process.env as Record<string, string | undefined>)[key];
      else (process.env as Record<string, string | undefined>)[key] = savedEnv[key];
    }
    global.fetch = origFetch;
    supabase.auth.signInWithPassword = origSignIn;
    supabase.auth.signUp = origSignUp;
    supabase.auth.refreshSession = origRefresh;
    supabase.auth.getUser = origGetUser;
  });

  describe('Distributed login/signup rate limiting', () => {
    test('login and signup consult the shared Redis limiter, so attempts on other instances count', async () => {
      const redis = createSharedRedis();
      global.fetch = redis.handler;
      process.env.UPSTASH_REDIS_REST_URL = REDIS_URL;
      process.env.UPSTASH_REDIS_REST_TOKEN = 'shared-redis-token';

      // Another instance already recorded the full login budget for this IP in shared Redis.
      // This instance's in-memory store has never seen the IP (as after a restart or on a new node).
      redis.seedAttempts('auth:login:203.0.113.10', 10);
      const blocked = await loginPost(credentialRequest('/api/auth/login', '203.0.113.10'));
      assert.strictEqual(blocked.status, 429, 'Limit recorded by another instance must be enforced here');
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.strictEqual(signInCalls, 0, 'Supabase must not be called once the shared limit is reached');

      redis.seedAttempts('auth:signup:203.0.113.10', 5);
      const blockedSignup = await signupPost(credentialRequest('/api/auth/signup', '203.0.113.10'));
      assert.strictEqual(blockedSignup.status, 429);
      assert.strictEqual(signUpCalls, 0);

      // Attempts from this instance are recorded in shared Redis for every other instance to see.
      for (let i = 0; i < 10; i++) {
        const res = await loginPost(
          credentialRequest('/api/auth/login', '203.0.113.11', {
            body: JSON.stringify({ email: `user${i}@thinkmate.ai`, password: 'correct-horse-battery' }),
          })
        );
        assert.strictEqual(res.status, 401, `Attempt ${i + 1} should reach credential verification`);
      }
      assert.strictEqual(redis.zsets.get('auth:login:203.0.113.11')?.length, 10);
      const eleventh = await loginPost(
        credentialRequest('/api/auth/login', '203.0.113.11', {
          body: JSON.stringify({ email: 'user11@thinkmate.ai', password: 'correct-horse-battery' }),
        })
      );
      assert.strictEqual(eleventh.status, 429);
      assert.ok(redis.evalKeys.includes('auth:signup:203.0.113.10'));
    });

    test('production rejects login/signup with 503 when Redis is unconfigured', async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.RATE_LIMIT_FAIL_CLOSED = 'false';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const login = await loginPost(credentialRequest('/api/auth/login', '203.0.113.20'));
      assert.strictEqual(login.status, 503);
      const signup = await signupPost(credentialRequest('/api/auth/signup', '203.0.113.20'));
      assert.strictEqual(signup.status, 503);
      assert.strictEqual(signInCalls + signUpCalls, 0, 'No credential check may run without the distributed limiter');
    });

    test('production rejects login/signup with 503 during a Redis outage', async () => {
      const redis = createSharedRedis();
      redis.setOutage(true);
      global.fetch = redis.handler;
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.RATE_LIMIT_FAIL_CLOSED = 'false';
      process.env.UPSTASH_REDIS_REST_URL = REDIS_URL;
      process.env.UPSTASH_REDIS_REST_TOKEN = 'shared-redis-token';

      const login = await loginPost(credentialRequest('/api/auth/login', '203.0.113.30'));
      assert.strictEqual(login.status, 503);
      const signup = await signupPost(credentialRequest('/api/auth/signup', '203.0.113.30'));
      assert.strictEqual(signup.status, 503);
      assert.strictEqual(signInCalls + signUpCalls, 0);
    });

    test('synchronous per-process checkRateLimit refuses auth keys in production', () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const res = checkRateLimit('auth:login:203.0.113.40', 10, 60000);
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.unavailable, true);
    });
  });

  describe('Credential endpoint CSRF policy (login CSRF)', () => {
    const cases: Array<{ name: string; headers: Record<string, string>; status: number }> = [
      { name: 'cross-origin Origin', headers: { Origin: 'https://attacker.example' }, status: 403 },
      { name: 'null Origin (sandboxed iframe)', headers: { Origin: 'null' }, status: 403 },
      { name: 'Sec-Fetch-Site cross-site', headers: { 'Sec-Fetch-Site': 'cross-site' }, status: 403 },
      { name: 'form-urlencoded body (HTML form)', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, status: 415 },
      { name: 'text/plain body (no-preflight fetch)', headers: { 'Content-Type': 'text/plain' }, status: 415 },
      { name: 'multipart body', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, status: 415 },
    ];

    for (const route of [
      { path: '/api/auth/login', handler: loginPost },
      { path: '/api/auth/signup', handler: signupPost },
    ]) {
      for (const c of cases) {
        test(`${route.path} rejects ${c.name} with ${c.status} without contacting Supabase`, async () => {
          const res = await route.handler(credentialRequest(route.path, '203.0.113.50', { headers: c.headers }));
          assert.strictEqual(res.status, c.status);
          assert.strictEqual(signInCalls + signUpCalls, 0);
        });
      }

      test(`${route.path} rejects requests with neither Origin nor Referer`, async () => {
        const req = new NextRequest(`http://localhost:3000${route.path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
          body: JSON.stringify({ email: 'user@thinkmate.ai', password: 'correct-horse-battery' }),
        });
        const res = await route.handler(req);
        assert.strictEqual(res.status, 403);
      });

      test(`${route.path} rejects cross-origin Referer when Origin is absent`, async () => {
        const req = new NextRequest(`http://localhost:3000${route.path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Host: 'localhost:3000', Referer: 'https://attacker.example/login' },
          body: JSON.stringify({ email: 'user@thinkmate.ai', password: 'correct-horse-battery' }),
        });
        assert.strictEqual((await route.handler(req)).status, 403);
      });
    }

    test('same-origin JSON, same-origin Referer, and configured TRUSTED_ORIGINS are accepted', async () => {
      const sameOrigin = await loginPost(
        credentialRequest('/api/auth/login', '203.0.113.60', { headers: { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json; charset=utf-8' } })
      );
      assert.strictEqual(sameOrigin.status, 401, 'Same-origin request must reach credential verification');

      const refererOnly = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: 'localhost:3000', Referer: 'http://localhost:3000/', 'x-forwarded-for': '203.0.113.61' },
        body: JSON.stringify({ email: 'user@thinkmate.ai', password: 'correct-horse-battery' }),
      });
      assert.strictEqual((await loginPost(refererOnly)).status, 401);

      process.env.TRUSTED_ORIGINS = 'https://app.thinkmate.ai';
      const trusted = await loginPost(
        credentialRequest('/api/auth/login', '203.0.113.62', { headers: { Origin: 'https://app.thinkmate.ai' } })
      );
      assert.strictEqual(trusted.status, 401);
      assert.strictEqual(signInCalls, 3);
    });
  });

  describe('Refresh race recovery issues correct cookies', () => {
    function useSharedRedis() {
      const redis = createSharedRedis();
      global.fetch = redis.handler;
      process.env.UPSTASH_REDIS_REST_URL = REDIS_URL;
      process.env.UPSTASH_REDIS_REST_TOKEN = 'shared-redis-token';
      return redis;
    }

    const rotated = (suffix: string) => ({
      session: {
        access_token: `access-rotated-${suffix}`,
        refresh_token: `refresh-rotated-${suffix}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
      user: { id: 'usr-refresh-race', email: 'race@thinkmate.ai' },
    });

    test('concurrent refreshes on an instance that lost the rotation race all receive the rotated cookies', async () => {
      useSharedRedis();
      const oldToken = `r1-concurrent-${Date.now()}`;
      const next = rotated(`concurrent-${Date.now()}`);

      // Instance A wins the rotation and publishes it to shared Redis shortly after B's requests arrive.
      setTimeout(() => {
        void saveDistributedRotatedSession(oldToken, next.session, next.user);
      }, 30);

      // Instance B: GoTrue rejects the already-rotated token.
      supabase.auth.refreshSession = (async () => ({
        data: { session: null, user: null },
        error: { message: 'Invalid Refresh Token: Already Used', name: 'AuthApiError', status: 400 },
      })) as unknown as typeof supabase.auth.refreshSession;

      const responses = await Promise.all(Array.from({ length: 4 }, () => refreshPost(refreshRequest(oldToken))));
      for (const res of responses) {
        assert.strictEqual(res.status, 200);
        const cookies = res.headers.get('set-cookie') || '';
        assert.ok(cookies.includes(`thinkmate_refresh_token=${next.session.refresh_token}`), `Missing rotated refresh cookie: ${cookies}`);
        assert.ok(cookies.includes(`sb-refresh-token=${next.session.refresh_token}`));
        assert.ok(cookies.includes(`thinkmate_auth_token=${next.session.access_token}`));
        assert.ok(!cookies.includes(oldToken), 'Stale refresh token must never be re-issued');
        assert.ok(!/thinkmate_refresh_token=;/.test(cookies), 'Rotated cookies must not be cleared');
      }
    });

    test('route recovers a rotation that lands after refreshUserSession stopped polling', async () => {
      const redis = useSharedRedis();
      const oldToken = `r1-late-${Date.now()}`;
      const next = rotated(`late-${Date.now()}`);
      await saveDistributedRotatedSession(oldToken, next.session, next.user);
      // Hide the record from the initial lookup and all three backoff polls; the route's final check sees it.
      const key = `auth:rotation:${hashTokenKey(oldToken)}`;
      redis.hideFirstGets(key, 4);

      supabase.auth.refreshSession = (async () => ({
        data: { session: null, user: null },
        error: { message: 'Invalid Refresh Token: Already Used', name: 'AuthApiError', status: 400 },
      })) as unknown as typeof supabase.auth.refreshSession;

      const res = await refreshPost(refreshRequest(oldToken));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(redis.getCounts.get(key), 5);
      const cookies = res.headers.get('set-cookie') || '';
      assert.ok(cookies.includes(`thinkmate_refresh_token=${next.session.refresh_token}`));
      assert.ok(cookies.includes(`thinkmate_auth_token=${next.session.access_token}`));
    });

    test('unrecoverable rotation with a still-valid access token returns 401 without touching cookies', async () => {
      useSharedRedis();
      const oldToken = `r1-unrecoverable-${Date.now()}`;
      supabase.auth.refreshSession = (async () => ({
        data: { session: null, user: null },
        error: { message: 'Invalid Refresh Token: Already Used', name: 'AuthApiError', status: 400 },
      })) as unknown as typeof supabase.auth.refreshSession;
      supabase.auth.getUser = (async () => ({
        data: { user: { id: 'usr-still-valid', email: 'valid@thinkmate.ai' } },
        error: null,
      })) as unknown as typeof supabase.auth.getUser;

      const res = await refreshPost(refreshRequest(oldToken, 'still-valid-access-token'));
      assert.strictEqual(res.status, 401, 'Must not report refresh success without issuing rotated cookies');
      const json = await res.json();
      assert.notStrictEqual(json.success, true);
      assert.strictEqual(json.code, 'REFRESH_ROTATION_UNRECOVERABLE');
      assert.strictEqual(json.sessionActive, true);
      assert.strictEqual(
        res.headers.get('set-cookie'),
        null,
        'Must not clear cookies that a concurrent successful response may have just rotated'
      );
    });

    test('unrecoverable rotation with an invalid access token returns 401 and clears cookies', async () => {
      useSharedRedis();
      supabase.auth.refreshSession = (async () => ({
        data: { session: null, user: null },
        error: { message: 'Invalid Refresh Token: Revoked', name: 'AuthApiError', status: 400 },
      })) as unknown as typeof supabase.auth.refreshSession;
      supabase.auth.getUser = (async () => ({
        data: { user: null },
        error: { message: 'invalid JWT', name: 'AuthApiError', status: 401 },
      })) as unknown as typeof supabase.auth.getUser;

      const res = await refreshPost(refreshRequest(`r1-revoked-${Date.now()}`, 'expired-access-token'));
      assert.strictEqual(res.status, 401);
      const cookies = res.headers.get('set-cookie') || '';
      assert.ok(cookies.includes('thinkmate_refresh_token=;'));
      assert.ok(cookies.includes('Max-Age=0'));
    });
  });
});
