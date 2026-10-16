import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  reportOperationalAlert,
  recordAuthFailure,
  _resetMonitoringState,
  OperationalAlert,
} from './monitoring';

describe('Operational Monitoring & Alerting System', () => {
  beforeEach(() => {
    _resetMonitoringState();
    delete process.env.ALERT_WEBHOOK_URL;
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

  it('tracks repeated authentication failures and alerts when threshold is exceeded', () => {
    const testIp = '198.51.100.42';

    // First 4 failures do not trigger alert
    for (let i = 0; i < 4; i++) {
      recordAuthFailure(testIp);
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
      recordAuthFailure(testIp);
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
});
