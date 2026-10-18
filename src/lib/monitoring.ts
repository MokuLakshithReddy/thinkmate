/**
 * ThinkMate Operational Monitoring & Alerting System
 *
 * Emits structured telemetry to stdout/stderr for cloud log aggregators (Datadog, CloudWatch, GCP)
 * and dispatches notifications to external webhooks (Slack, Discord, PagerDuty) via ALERT_WEBHOOK_URL.
 *
 * Features:
 * 1. Distributed or in-memory rate-throttling & deduplication (prevents alert storms across instances).
 * 2. Distributed or in-memory tracking of consecutive authentication failures per IP.
 * 3. Strict HTTP status verification for external webhook delivery with failure metrics.
 */

export type AlertType =
  | 'REPEATED_AUTH_FAILURES'
  | 'REDIS_OUTAGE'
  | 'ELEVATED_API_ERRORS'
  | 'AI_PROVIDER_FAILURE'
  | 'READINESS_FAILURE'
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID';

export interface AlertDetails extends Record<string, unknown> {
  error?: string;
  key?: string;
  action?: string;
  runbook?: string;
  ip?: string;
  route?: string;
  count?: number;
  statusCode?: number;
}

export interface OperationalAlert {
  tag: 'THINKMATE_OPERATOR_ALERT';
  type: AlertType;
  severity: 'CRITICAL' | 'HIGH' | 'WARNING';
  timestamp: string;
  environment: string;
  details: AlertDetails;
}

export interface MonitoringDiagnostics {
  webhookConfigured: boolean;
  webhookStatus: 'healthy' | 'failing' | 'unconfigured';
  webhookDeliveriesSuccessful: number;
  webhookDeliveriesFailed: number;
  lastWebhookError: string | null;
  lastWebhookDeliveredAt: string | null;
  distributedDeduplication: boolean;
}

const SEVERITY_MAP: Record<AlertType, 'CRITICAL' | 'HIGH' | 'WARNING'> = {
  REDIS_OUTAGE: 'CRITICAL',
  READINESS_FAILURE: 'CRITICAL',
  REPEATED_AUTH_FAILURES: 'HIGH',
  AI_PROVIDER_FAILURE: 'HIGH',
  ELEVATED_API_ERRORS: 'HIGH',
  CONFIG_MISSING: 'HIGH',
  CONFIG_INVALID: 'WARNING',
};

// In-memory fallback deduplication cache: tracks timestamp of last sent alert per signature
const alertDeduplicationMap = new Map<string, number>();
const DEDUPLICATION_WINDOW_MS = 60_000; // 60 seconds
const DEDUPLICATION_WINDOW_SEC = 60;

// In-memory fallback sliding window for tracking rapid consecutive authentication failures per IP
const authFailureCounters = new Map<string, { count: number; firstFailureAt: number }>();
const AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_ALERT_THRESHOLD = 5;

// Webhook delivery telemetry metrics
let webhookDeliveriesSuccessful = 0;
let webhookDeliveriesFailed = 0;
let lastWebhookError: string | null = null;
let lastWebhookDeliveredAt: number | null = null;

export interface RedisCommandOutcome<T = unknown> {
  success: boolean;
  result?: T | null;
  error?: string;
}

/**
 * Execute an atomic command on Upstash Redis via REST API.
 * Distinguishes an intentional Redis response containing { result: null } (e.g. SET NX conflict)
 * from a connection or authentication failure (success: false).
 */
export async function executeRedisCommand<T = unknown>(
  command: (string | number)[]
): Promise<RedisCommandOutcome<T>> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || typeof fetch === 'undefined') {
    return { success: false, error: 'Redis unconfigured' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    if (json && typeof json === 'object' && 'error' in json && json.error) {
      return { success: false, error: String(json.error) };
    }
    if (!json || typeof json !== 'object' || !('result' in json)) {
      return { success: false, error: 'Malformed Redis response' };
    }
    return { success: true, result: (json.result !== undefined ? json.result : null) as T | null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Checks whether an alert with this signature should be emitted.
 * If Redis is configured and reachable:
 *   - SET key 1 EX 60 NX returns 'OK' -> slot successfully acquired (emit).
 *   - SET key 1 EX 60 NX returns null -> another instance already owns the key within 60s (DO NOT EMIT).
 * Falls back to in-memory timestamp tracking ONLY when Redis is unconfigured or encounters a network failure.
 */
export async function acquireDeduplicationSlot(signature: string, force: boolean): Promise<boolean> {
  if (force) return true;

  const redisKey = `alert:dedup:${signature}`;
  const outcome = await executeRedisCommand<string>(['SET', redisKey, '1', 'EX', DEDUPLICATION_WINDOW_SEC, 'NX']);

  if (outcome.success) {
    // Redis responded affirmatively.
    // 'OK' means this instance acquired the lock.
    // null means another instance already holds the lock within the window.
    // In BOTH cases, do NOT fall back to in-memory.
    const acquired = outcome.result === 'OK';
    if (acquired) {
      alertDeduplicationMap.set(signature, Date.now());
    }
    return acquired;
  }

  // Fallback to in-memory deduplication ONLY on Redis/network failure or when unconfigured
  const now = Date.now();
  const lastEmitted = alertDeduplicationMap.get(signature) || 0;
  if (now - lastEmitted < DEDUPLICATION_WINDOW_MS) {
    return false;
  }
  alertDeduplicationMap.set(signature, now);
  return true;
}

/**
 * Dispatches an operational alert.
 * 1. Outputs structured JSON log to console.error (captured by cloud loggers).
 * 2. Dispatches asynchronously to ALERT_WEBHOOK_URL if configured, validating HTTP response.
 */
/**
 * Schedules background asynchronous work using Next.js after() when available in serverless
 * request execution contexts, falling back to a monitored detached promise.
 */
export function scheduleBackgroundWork(task: () => Promise<void>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nextServer = require('next/server');
    if (typeof nextServer.after === 'function') {
      nextServer.after(task);
      return;
    }
  } catch {
    // Non-server context or after() unavailable
  }
  void task().catch(() => {});
}

/**
 * Persists an alert to a durable Redis queue ('alert:durable_queue') with bounded retention (500 entries).
 * Ensures critical alerts are preserved even across serverless execution terminations.
 */
export async function enqueueDurableAlert(alert: OperationalAlert): Promise<boolean> {
  const payloadStr = JSON.stringify(alert);
  const outcome = await executeRedisCommand<number>([
    'LPUSH',
    'alert:durable_queue',
    payloadStr,
  ]);
  if (outcome.success) {
    void executeRedisCommand(['LTRIM', 'alert:durable_queue', '0', '499']).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Retrieves the latest alerts stored in the durable Redis queue.
 */
export async function peekDurableAlertQueue(limit = 10): Promise<OperationalAlert[]> {
  const outcome = await executeRedisCommand<string[]>([
    'LRANGE',
    'alert:durable_queue',
    '0',
    String(Math.max(0, limit - 1)),
  ]);
  if (!outcome.success || !Array.isArray(outcome.result)) return [];
  const alerts: OperationalAlert[] = [];
  for (const item of outcome.result) {
    try {
      alerts.push(JSON.parse(item));
    } catch {
      // ignore malformed item
    }
  }
  return alerts;
}

/**
 * Dispatches an operational alert.
 * 1. Outputs structured JSON log to console.error (captured by cloud loggers).
 * 2. Enqueues critical alerts durably into Redis.
 * 3. Dispatches to ALERT_WEBHOOK_URL via supported background mechanism or durable queue.
 */
export function reportOperationalAlert(
  type: AlertType,
  details: AlertDetails = {},
  options: { force?: boolean; skipBackgroundWebhook?: boolean } = {}
): OperationalAlert | null {
  const signature = `${type}:${details.key || details.route || details.ip || 'general'}`;

  // In-memory quick check to immediately throttle repeated synchronous calls on this instance
  const now = Date.now();
  const lastEmitted = alertDeduplicationMap.get(signature) || 0;
  if (!options.force && now - lastEmitted < DEDUPLICATION_WINDOW_MS) {
    return null;
  }
  alertDeduplicationMap.set(signature, now);

  const alertPayload: OperationalAlert = {
    tag: 'THINKMATE_OPERATOR_ALERT',
    type,
    severity: SEVERITY_MAP[type] || 'WARNING',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    details,
  };

  // Structured console log for Datadog / CloudWatch / GCP
  console.error(`\n[OPERATOR ALERT] [${alertPayload.severity}] ${type}:`, JSON.stringify(alertPayload, null, 2), '\n');

  // Register in Redis asynchronously so separate application instances also deduplicate this signature
  const redisKey = `alert:dedup:${signature}`;
  void executeRedisCommand(['SET', redisKey, '1', 'EX', DEDUPLICATION_WINDOW_SEC, 'NX']).catch(() => {});

  // For critical alerts, durably record in Redis queue so notifications survive serverless termination
  let alreadyEnqueuedDurable = false;
  if (alertPayload.severity === 'CRITICAL') {
    void enqueueDurableAlert(alertPayload).catch(() => {});
    alreadyEnqueuedDurable = true;
  }

  // External webhook dispatch with status code verification and background scheduling
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!options.skipBackgroundWebhook && webhookUrl && typeof fetch !== 'undefined') {
    const deliverTask = async () => {
      try {
        await dispatchWebhookNotification(webhookUrl, alertPayload);
      } catch (webhookErr) {
        webhookDeliveriesFailed += 1;
        lastWebhookError = webhookErr instanceof Error ? webhookErr.message : String(webhookErr);
        console.warn('[OPERATOR ALERT] Webhook delivery failed:', lastWebhookError);
        // Persist non-critical alerts that failed delivery to durable queue as backup
        if (!alreadyEnqueuedDurable) {
          await enqueueDurableAlert(alertPayload).catch(() => {});
        }
      }
    };

    scheduleBackgroundWork(deliverTask);
  }

  return alertPayload;
}

/**
 * Async version of reportOperationalAlert with cross-instance Redis deduplication guarantees
 * and optional synchronous delivery verification.
 */
export async function reportOperationalAlertAsync(
  type: AlertType,
  details: AlertDetails = {},
  options: { force?: boolean; awaitDelivery?: boolean } = {}
): Promise<OperationalAlert | null> {
  const signature = `${type}:${details.key || details.route || details.ip || 'general'}`;
  const shouldEmit = await acquireDeduplicationSlot(signature, !!options.force);
  if (!shouldEmit) return null;

  const shouldAwait = Boolean(options.awaitDelivery || SEVERITY_MAP[type] === 'CRITICAL');
  const alert = reportOperationalAlert(type, details, { force: true, skipBackgroundWebhook: shouldAwait });
  if (alert && shouldAwait) {
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (webhookUrl && typeof fetch !== 'undefined') {
      try {
        await dispatchWebhookNotification(webhookUrl, alert);
      } catch (err) {
        webhookDeliveriesFailed += 1;
        lastWebhookError = err instanceof Error ? err.message : String(err);
        if (alert.severity !== 'CRITICAL') {
          await enqueueDurableAlert(alert).catch(() => {});
        }
      }
    }
  }
  return alert;
}

/**
 * Delivers the alert payload to an external webhook endpoint.
 * Explicitly validates HTTP 2xx response status; throws if non-2xx to ensure delivery failures are recorded.
 */
export async function dispatchWebhookNotification(url: string, payload: OperationalAlert): Promise<void> {
  const formattedBody = {
    text: `🚨 *[${payload.severity}] ThinkMate Operator Alert: ${payload.type}* (${payload.environment})\n\`\`\`json\n${JSON.stringify(payload.details, null, 2)}\n\`\`\``,
    alert: payload,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formattedBody),
    signal: AbortSignal.timeout(4000),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Webhook returned HTTP ${res.status}: ${errorBody.slice(0, 150)}`);
  }

  webhookDeliveriesSuccessful += 1;
  lastWebhookDeliveredAt = Date.now();
  lastWebhookError = null;
}

/**
 * Tracks failed authentication attempts by IP across instances using Redis, falling back to local memory.
 * Emits REPEATED_AUTH_FAILURES alert if failure threshold is reached within the observation window.
 * Routes the resulting alert through the distributed asynchronous deduplication path.
 */
export async function recordAuthFailure(ip: string, route: string = '/api/auth/login'): Promise<number> {
  let count = 0;
  let isDistributed = false;

  // Try distributed counter in Redis first
  const redisKey = `auth:failures:${ip}`;
  const incrOutcome = await executeRedisCommand<number>(['INCR', redisKey]);

  if (incrOutcome.success && typeof incrOutcome.result === 'number') {
    count = incrOutcome.result;
    isDistributed = true;
    if (count === 1) {
      // Set window TTL on the first recorded failure
      await executeRedisCommand(['EXPIRE', redisKey, 60]);
    }
  } else {
    // Fall back to in-memory sliding window
    const now = Date.now();
    const entry = authFailureCounters.get(ip);
    if (!entry || now - entry.firstFailureAt > AUTH_FAILURE_WINDOW_MS) {
      authFailureCounters.set(ip, { count: 1, firstFailureAt: now });
      count = 1;
    } else {
      entry.count += 1;
      count = entry.count;
    }
  }

  if (count >= AUTH_FAILURE_ALERT_THRESHOLD) {
    // Route repeated-auth-failure alerts through the distributed async path!
    await reportOperationalAlertAsync('REPEATED_AUTH_FAILURES', {
      ip,
      route,
      count,
      windowMs: AUTH_FAILURE_WINDOW_MS,
      distributed: isDistributed,
      runbook: 'Investigate IP for credential stuffing or brute-force attack. Consider blocking at edge firewall.',
    });
  }

  return count;
}

/**
 * Returns diagnostic metrics about the operational monitoring subsystem.
 */
export function getMonitoringDiagnostics(): MonitoringDiagnostics {
  const isWebhookConfigured = Boolean(process.env.ALERT_WEBHOOK_URL);
  let status: 'healthy' | 'failing' | 'unconfigured' = 'unconfigured';
  if (isWebhookConfigured) {
    status = webhookDeliveriesFailed > 0 && webhookDeliveriesSuccessful === 0 ? 'failing' : 'healthy';
  }

  return {
    webhookConfigured: isWebhookConfigured,
    webhookStatus: status,
    webhookDeliveriesSuccessful,
    webhookDeliveriesFailed,
    lastWebhookError,
    lastWebhookDeliveredAt: lastWebhookDeliveredAt ? new Date(lastWebhookDeliveredAt).toISOString() : null,
    distributedDeduplication: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  };
}

/**
 * Resets memory state and delivery telemetry (useful for unit tests).
 */
export function _resetMonitoringState(): void {
  alertDeduplicationMap.clear();
  authFailureCounters.clear();
  webhookDeliveriesSuccessful = 0;
  webhookDeliveriesFailed = 0;
  lastWebhookError = null;
  lastWebhookDeliveredAt = null;
}
