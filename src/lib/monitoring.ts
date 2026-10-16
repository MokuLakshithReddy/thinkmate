/**
 * ThinkMate Operational Monitoring & Alerting System
 *
 * Emits structured telemetry to stdout/stderr for cloud log aggregators (Datadog, CloudWatch, GCP)
 * and dispatches notifications to external webhooks (Slack, Discord, PagerDuty) via ALERT_WEBHOOK_URL.
 *
 * Includes rate-throttling and deduplication to prevent alert storms during widespread outages.
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

const SEVERITY_MAP: Record<AlertType, 'CRITICAL' | 'HIGH' | 'WARNING'> = {
  REDIS_OUTAGE: 'CRITICAL',
  READINESS_FAILURE: 'CRITICAL',
  REPEATED_AUTH_FAILURES: 'HIGH',
  AI_PROVIDER_FAILURE: 'HIGH',
  ELEVATED_API_ERRORS: 'HIGH',
  CONFIG_MISSING: 'HIGH',
  CONFIG_INVALID: 'WARNING',
};

// Deduplication cache: tracks timestamp of last sent alert per signature to prevent alert fatigue
const alertDeduplicationMap = new Map<string, number>();
const DEDUPLICATION_WINDOW_MS = 60_000; // 60 seconds

// In-memory sliding window for tracking rapid consecutive authentication failures per IP
const authFailureCounters = new Map<string, { count: number; firstFailureAt: number }>();
const AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_ALERT_THRESHOLD = 5;

/**
 * Dispatches an operational alert.
 * 1. Outputs structured JSON log to console.error (captured by cloud loggers).
 * 2. Asynchronously posts to ALERT_WEBHOOK_URL if configured, with deduplication.
 */
export function reportOperationalAlert(
  type: AlertType,
  details: AlertDetails = {},
  options: { force?: boolean } = {}
): OperationalAlert | null {
  const signature = `${type}:${details.key || details.route || details.ip || 'general'}`;
  const now = Date.now();
  const lastEmitted = alertDeduplicationMap.get(signature) || 0;

  if (!options.force && now - lastEmitted < DEDUPLICATION_WINDOW_MS) {
    // Throttled to avoid flooding logs and external channels
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

  // Structured console log
  console.error(`\n[OPERATOR ALERT] [${alertPayload.severity}] ${type}:`, JSON.stringify(alertPayload, null, 2), '\n');

  // Asynchronous external webhook dispatch (non-blocking)
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl && typeof fetch !== 'undefined') {
    void dispatchWebhookNotification(webhookUrl, alertPayload).catch((webhookErr) => {
      console.warn('[OPERATOR ALERT] Webhook delivery failed:', webhookErr instanceof Error ? webhookErr.message : String(webhookErr));
    });
  }

  return alertPayload;
}

/**
 * Delivers the alert payload to an external webhook endpoint.
 */
async function dispatchWebhookNotification(url: string, payload: OperationalAlert): Promise<void> {
  const formattedBody = {
    text: `🚨 *[${payload.severity}] ThinkMate Operator Alert: ${payload.type}* (${payload.environment})\n\`\`\`json\n${JSON.stringify(payload.details, null, 2)}\n\`\`\``,
    alert: payload,
  };

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formattedBody),
    signal: AbortSignal.timeout(4000),
  });
}

/**
 * Tracks failed authentication attempts by IP.
 * Emits REPEATED_AUTH_FAILURES alert if failure threshold is exceeded within the observation window.
 */
export function recordAuthFailure(ip: string, route: string = '/api/auth/login'): void {
  const now = Date.now();
  const entry = authFailureCounters.get(ip);

  if (!entry || now - entry.firstFailureAt > AUTH_FAILURE_WINDOW_MS) {
    authFailureCounters.set(ip, { count: 1, firstFailureAt: now });
    return;
  }

  entry.count += 1;
  if (entry.count >= AUTH_FAILURE_ALERT_THRESHOLD) {
    reportOperationalAlert('REPEATED_AUTH_FAILURES', {
      ip,
      route,
      count: entry.count,
      windowMs: AUTH_FAILURE_WINDOW_MS,
      runbook: 'Investigate IP for credential stuffing or brute-force attack. Consider blocking at edge firewall.',
    });
  }
}

/**
 * Resets memory state (useful for unit tests).
 */
export function _resetMonitoringState(): void {
  alertDeduplicationMap.clear();
  authFailureCounters.clear();
}
