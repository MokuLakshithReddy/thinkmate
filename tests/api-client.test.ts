import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch } from '../src/lib/thinkmate/api-client';

describe('ThinkMate apiFetch Client', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = origFetch;
  });

  it('passes through successful responses', async () => {
    (globalThis as any).fetch = async (url: string) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const res = await apiFetch('/api/test');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.deepStrictEqual(data, { ok: true });
  });

  it('attempts session refresh once on 401 and retries the request', async () => {
    let callCount = 0;
    let refreshCalled = false;

    (globalThis as any).fetch = async (url: string) => {
      if (url === '/api/auth/refresh') {
        refreshCalled = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify({ recovered: true }), { status: 200 });
    };

    const res = await apiFetch('/api/protected');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(refreshCalled, true);
    assert.strictEqual(callCount, 2);
    const data = await res.json();
    assert.deepStrictEqual(data, { recovered: true });
  });

  it('returns 401 if refresh fails', async () => {
    let callCount = 0;

    (globalThis as any).fetch = async (url: string) => {
      if (url === '/api/auth/refresh') {
        return new Response(JSON.stringify({ error: 'invalid_refresh_token' }), { status: 401 });
      }
      callCount++;
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    };

    const res = await apiFetch('/api/protected');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(callCount, 1);
  });
});
