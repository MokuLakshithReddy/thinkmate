import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  reportOperationalAlert,
  reportOperationalAlertAsync,
  recordAuthFailure,
  dispatchWebhookNotification,
  getMonitoringDiagnostics,
  _resetMonitoringState,
  OperationalAlert,
} from './monitoring';

describe('Operational Monitoring & Alerting System', () => {
  beforeEach(() => {
    _resetMonitoringState();
    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('generates structured operational alerts with appropriate severity', () => {
    const alert = reportOperationalAlert('REDIS_OUTAGE', {
      key: 'auth:login:127.0.0.1',
      error: 'Connection timeout',
    });

    assert.ok(alert);
    assert.strictEqual(alert.tag, 'THINKMATE_OPERATOR_ALERT');
    assert.strictEqual(alert.type, 'REDIS_OUTAGE');
    assert.strictEqual(alert.severity, 'CRITICAL');
    assert.strictEqual(alert.details.key, 'auth:login:127.0.0.1');
    assert.strictEqual(alert.details.error, 'Connection timeout');
  });

  it('deduplicates rapid alerts for the same signature within deduplication window', () => {
    const alert1 = reportOperationalAlert('READINESS_FAILURE', { route: '/api/health' });
    assert.ok(alert1);

    // Second call with same signature within window should be throttled (returns null)
    const alert2 = reportOperationalAlert('READINESS_FAILURE', { route: '/api/health' });
    assert.strictEqual(alert2, null);

    // Forcing the alert bypasses deduplication
    const alert3 = reportOperationalAlert('READINESS_FAILURE', { route: '/api/health' }, { force: true });
    assert.ok(alert3);
  });

  it('tracks repeated authentication failures and alerts when threshold is exceeded', async () => {
    const testIp = '198.51.100.42';

    // First 4 failures do not trigger alert
    for (let i = 0; i < 4; i++) {
      await recordAuthFailure(testIp);
    }

    // 5th failure triggers REPEATED_AUTH_FAILURES alert
    let capturedAlert: OperationalAlert | null = null;
    const originalConsoleError = console.error;
    console.error = (msg: unknown, json?: unknown) => {
      if (typeof json === 'string') {
        try {
          const parsed = JSON.parse(json);
          if (parsed.type === 'REPEATED_AUTH_FAILURES') {
            capturedAlert = parsed;
          }
        } catch {
          // ignore
        }
      }
    };

    try {
      await recordAuthFailure(testIp);
      assert.ok(capturedAlert, 'Expected an alert on 5th consecutive auth failure');
      const finalAlert = capturedAlert as OperationalAlert;
      assert.strictEqual(finalAlert.type, 'REPEATED_AUTH_FAILURES');
      assert.strictEqual(finalAlert.severity, 'HIGH');
      assert.strictEqual(finalAlert.details.ip, testIp);
      assert.strictEqual(finalAlert.details.count, 5);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('attempts webhook delivery when ALERT_WEBHOOK_URL is configured', async () => {
    let webhookCalled = false;
    let deliveredBody = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      webhookCalled = true;
      deliveredBody = String(init?.body || '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/ALERT/WEBHOOK';

    try {
      reportOperationalAlert('AI_PROVIDER_FAILURE', {
        error: 'RESOURCE_EXHAUSTED: Quota exceeded for model gemini-2.5-flash',
      });

      // Allow microtask queue to process async webhook dispatch
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(webhookCalled, true);
      assert.ok(deliveredBody.includes('AI_PROVIDER_FAILURE'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('records webhook delivery failure when endpoint returns non-2xx HTTP status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response('Invalid webhook token', { status: 403 });
    }) as typeof fetch;

    const sampleAlert: OperationalAlert = {
      tag: 'THINKMATE_OPERATOR_ALERT',
      type: 'READINESS_FAILURE',
      severity: 'CRITICAL',
      timestamp: new Date().toISOString(),
      environment: 'production',
      details: { route: '/api/health' },
    };

    try {
      await assert.rejects(
        async () => {
          await dispatchWebhookNotification('https://example.com/bad-webhook', sampleAlert);
        },
        /Webhook returned HTTP 403: Invalid webhook token/
      );

      const diag = getMonitoringDiagnostics();
      assert.strictEqual(diag.webhookDeliveriesFailed, 0); // dispatchWebhookNotification itself throws; background wrapper tracks count
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('tracks failed delivery counts and updates diagnostics on background delivery failures', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as typeof fetch;

    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/FAILING/HOOK';

    try {
      reportOperationalAlert('REDIS_OUTAGE', { error: 'Redis PING timeout' });

      // Allow microtask queue to process async webhook dispatch
      await new Promise((r) => setTimeout(r, 60));

      const diag = getMonitoringDiagnostics();
      assert.strictEqual(diag.webhookStatus, 'failing');
      assert.strictEqual(diag.webhookDeliveriesFailed, 1);
      assert.ok(diag.lastWebhookError?.includes('Webhook returned HTTP 500'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('supports distributed deduplication via reportOperationalAlertAsync with Redis simulation', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://test-db.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

    const redisCommandsRun: (string | number)[][] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const parsedBody = JSON.parse(String(init?.body || '[]'));
      redisCommandsRun.push(parsedBody);
      // First SET NX returns 'OK', subsequent returns null
      const isSetNx = Array.isArray(parsedBody) && parsedBody[0] === 'SET' && parsedBody.includes('NX');
      if (isSetNx) {
        return new Response(JSON.stringify({ result: redisCommandsRun.length === 1 ? 'OK' : null }));
      }
      return new Response(JSON.stringify({ result: 'OK' }));
    }) as typeof fetch;

    try {
      const alert1 = await reportOperationalAlertAsync('REDIS_OUTAGE', { error: 'Node failover' });
      assert.ok(alert1, 'First distributed alert should be emitted');

      const alert2 = await reportOperationalAlertAsync('REDIS_OUTAGE', { error: 'Node failover' });
      assert.strictEqual(alert2, null, 'Second distributed alert should be suppressed by Redis SET NX');

      assert.ok(redisCommandsRun.length >= 2);
      assert.strictEqual(redisCommandsRun[0][0], 'SET');
      assert.ok(String(redisCommandsRun[0][1]).startsWith('alert:dedup:REDIS_OUTAGE'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('regression: two independent application instances sharing Redis state do not emit duplicate alerts', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://cluster-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'cluster-token';

    // Shared Redis datastore across instances
    const sharedRedisStore = new Map<string, unknown>();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const parsedBody = JSON.parse(String(init?.body || '[]'));
      const command = parsedBody[0];

      if (command === 'SET') {
        const key = String(parsedBody[1]);
        const isNx = parsedBody.includes('NX');
        if (isNx && sharedRedisStore.has(key)) {
          // Redis SET ... NX returns null when key exists
          return new Response(JSON.stringify({ result: null }));
        }
        sharedRedisStore.set(key, parsedBody[2]);
        return new Response(JSON.stringify({ result: 'OK' }));
      }

      if (command === 'INCR') {
        const key = String(parsedBody[1]);
        const current = (Number(sharedRedisStore.get(key)) || 0) + 1;
        sharedRedisStore.set(key, current);
        return new Response(JSON.stringify({ result: current }));
      }

      if (command === 'EXPIRE') {
        return new Response(JSON.stringify({ result: 1 }));
      }

      return new Response(JSON.stringify({ result: null }));
    }) as typeof fetch;

    try {
      // Instance A triggers the alert first
      _resetMonitoringState(); // Instance A local memory
      const instanceA_Alert = await reportOperationalAlertAsync('REDIS_OUTAGE', { key: 'cluster-db-partition' });
      assert.ok(instanceA_Alert, 'Instance A should acquire the Redis slot and emit alert');

      // Instance B starts with completely clean local memory (simulating a separate container/process)
      _resetMonitoringState(); // Instance B local memory (empty in-memory map)
      const instanceB_Alert = await reportOperationalAlertAsync('REDIS_OUTAGE', { key: 'cluster-db-partition' });

      // Instance B must NOT fall back to in-memory deduplication; Redis confirmed key already exists (result: null)
      assert.strictEqual(instanceB_Alert, null, 'Instance B must NOT emit duplicate alert when Redis holds key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('regression: two independent application instances aggregate auth failures in shared Redis and alert via async distributed path', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://cluster-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'cluster-token';

    const sharedRedisStore = new Map<string, unknown>();
    let alertEmissions = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const parsedBody = JSON.parse(String(init?.body || '[]'));
      const command = parsedBody[0];

      if (command === 'SET') {
        const key = String(parsedBody[1]);
        const isNx = parsedBody.includes('NX');
        if (isNx && sharedRedisStore.has(key)) {
          return new Response(JSON.stringify({ result: null }));
        }
        sharedRedisStore.set(key, parsedBody[2]);
        return new Response(JSON.stringify({ result: 'OK' }));
      }

      if (command === 'INCR') {
        const key = String(parsedBody[1]);
        const current = (Number(sharedRedisStore.get(key)) || 0) + 1;
        sharedRedisStore.set(key, current);
        return new Response(JSON.stringify({ result: current }));
      }

      if (command === 'EXPIRE') {
        return new Response(JSON.stringify({ result: 1 }));
      }

      return new Response(JSON.stringify({ result: null }));
    }) as typeof fetch;

    const originalConsoleError = console.error;
    console.error = (msg: unknown, json?: unknown) => {
      if (typeof json === 'string') {
        try {
          const parsed = JSON.parse(json);
          if (parsed.type === 'REPEATED_AUTH_FAILURES') {
            alertEmissions += 1;
          }
        } catch {
          // ignore
        }
      }
    };

    try {
      const victimIp = '198.51.100.222';

      // Instance A records 2 auth failures from victimIp
      _resetMonitoringState();
      await recordAuthFailure(victimIp);
      await recordAuthFailure(victimIp);
      assert.strictEqual(alertEmissions, 0);

      // Instance B (separate instance, fresh memory) records 3 more auth failures from victimIp
      _resetMonitoringState();
      await recordAuthFailure(victimIp);
      await recordAuthFailure(victimIp);
      await recordAuthFailure(victimIp); // Reaches 5 in shared Redis!

      // Alert emitted by Instance B
      assert.strictEqual(alertEmissions, 1, 'Instance B should trigger alert when shared Redis counter reaches 5');

      // Instance A (fresh memory) records 6th failure
      _resetMonitoringState();
      await recordAuthFailure(victimIp);

      // Alert should still be 1 because Redis SET NX deduplication suppressed the duplicate on Instance A!
      assert.strictEqual(alertEmissions, 1, 'Instance A must not duplicate alert within the deduplication window');
    } finally {
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
    }
  });
});
