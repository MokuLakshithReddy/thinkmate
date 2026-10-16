import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { NextRequest } from 'next/server';

const SECRETS = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://db.health.test',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-secret-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value',
  GEMINI_API_KEY: 'gemini-secret-value',
  UPSTASH_REDIS_REST_URL: 'https://redis.health.test',
  UPSTASH_REDIS_REST_TOKEN: 'upstash-token-secret-value',
  SESSION_ENCRYPTION_KEY: 'session-key-secret-value-0123456789abcdef',
};
const MANAGED = [...Object.keys(SECRETS), 'NODE_ENV', 'GOOGLE_API_KEY', 'ROTATION_SECRET'];
const env = process.env as Record<string, string | undefined>;

let saved: Record<string, string | undefined>;
let originalFetch: typeof fetch;
let redisHealthy: boolean;

function setEnv(overrides: Record<string, string | undefined>) {
  for (const key of MANAGED) delete env[key];
  for (const [key, value] of Object.entries({ ...SECRETS, ...overrides })) {
    if (value !== undefined) env[key] = value;
  }
}

async function probe(readiness: boolean) {
  // Imported lazily: supabase-client reads NEXT_PUBLIC_SUPABASE_URL at module load.
  const { GET: healthGet } = await import('./health/route');
  const res = await healthGet(new NextRequest(`http://localhost:3000/api/health${readiness ? '?readiness=true' : ''}`));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

describe('GET /api/health auth infrastructure readiness', () => {
  beforeEach(() => {
    saved = Object.fromEntries(MANAGED.map((k) => [k, env[k]]));
    originalFetch = globalThis.fetch;
    redisHealthy = true;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(SECRETS.UPSTASH_REDIS_REST_URL)) {
        return redisHealthy ? Response.json({ result: 'PONG' }) : new Response('down', { status: 503 });
      }
      if (url.startsWith(SECRETS.NEXT_PUBLIC_SUPABASE_URL)) {
        return Response.json([], { headers: { 'content-range': '0-0/*' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  test('production with Redis, rotation key, database and AI configured is ready (200)', async () => {
    setEnv({ NODE_ENV: 'production' });
    const { status, json } = await probe(true);
    assert.strictEqual(json.dependencies.database.status, 'ready');
    assert.deepStrictEqual(json.dependencies.authInfrastructure, {
      status: 'ready',
      rateLimiter: { provider: 'Upstash Redis', status: 'ready', distributed: true },
      sessionEncryption: { status: 'ready' },
    });
    assert.strictEqual(json.readiness, 'ready');
    assert.strictEqual(status, 200);
  });

  test('production without Redis is not ready (503) even though database and AI are', async () => {
    setEnv({ NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
    const { status, json } = await probe(true);
    assert.strictEqual(status, 503);
    assert.strictEqual(json.dependencies.database.status, 'ready');
    assert.strictEqual(json.dependencies.aiProvider.status, 'ready');
    assert.strictEqual(json.dependencies.authInfrastructure.status, 'unavailable');
    assert.strictEqual(json.dependencies.authInfrastructure.rateLimiter.status, 'unconfigured');
    assert.strictEqual(json.readiness, 'degraded');
  });

  test('production with unreachable Redis is not ready (503)', async () => {
    setEnv({ NODE_ENV: 'production' });
    redisHealthy = false;
    const { status, json } = await probe(true);
    assert.strictEqual(status, 503);
    assert.strictEqual(json.dependencies.authInfrastructure.rateLimiter.status, 'unreachable');
  });

  test('production with an invalid Redis URL is not ready and does not echo it', async () => {
    setEnv({ NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'ftp://user:hunter2@redis.internal' });
    const { status, json, text } = await probe(true);
    assert.strictEqual(status, 503);
    assert.strictEqual(json.dependencies.authInfrastructure.rateLimiter.status, 'invalid');
    assert.ok(!text.includes('hunter2') && !text.includes('redis.internal'));
  });

  test('production without a dedicated rotation key is not ready (503)', async () => {
    setEnv({ NODE_ENV: 'production', SESSION_ENCRYPTION_KEY: undefined });
    const { status, json } = await probe(true);
    assert.strictEqual(status, 503);
    assert.strictEqual(json.dependencies.authInfrastructure.sessionEncryption.status, 'unconfigured');
  });

  test('liveness stays 200 when production auth infrastructure is missing', async () => {
    setEnv({ NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
    const { status, json } = await probe(false);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.liveness, 'up');
    assert.strictEqual(json.dependencies.authInfrastructure.status, 'unavailable');
  });

  test('non-production uses the in-memory limiter without failing readiness', async () => {
    setEnv({ NODE_ENV: 'development', UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined, SESSION_ENCRYPTION_KEY: undefined });
    const { status, json } = await probe(true);
    assert.strictEqual(json.dependencies.authInfrastructure.status, 'ready');
    assert.strictEqual(json.dependencies.authInfrastructure.rateLimiter.status, 'memory_fallback');
    assert.strictEqual(json.dependencies.authInfrastructure.rateLimiter.distributed, false);
    assert.strictEqual(status, 200);
  });

  test('responses never contain secret values or the Redis/Supabase URLs', async () => {
    for (const readiness of [true, false]) {
      setEnv({ NODE_ENV: 'production' });
      const { text } = await probe(readiness);
      for (const value of Object.values(SECRETS)) {
        assert.ok(!text.includes(value), `leaked ${value}`);
      }
      assert.ok(!text.includes('redis.health.test') && !text.includes('db.health.test'));
    }
  });
});
