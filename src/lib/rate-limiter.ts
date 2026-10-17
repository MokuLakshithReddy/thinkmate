import { isIP } from 'node:net';
import { reportOperationalAlert, reportOperationalAlertAsync } from '@/lib/monitoring';
import { NextResponse } from 'next/server';

export interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  /** True when the request was rejected because the distributed limiter is unavailable or unconfigured (fail-closed). */
  unavailable?: boolean;
}

export interface RateLimitStore {
  get(key: string): Promise<number[]> | number[];
  set(key: string, timestamps: number[]): Promise<void> | void;
  checkAndRecord?(key: string, limit: number, windowMs: number): Promise<RateLimitResult> | RateLimitResult;
}

/**
 * In-Memory Sliding Window Store with Atomic Check-and-Record.
 * Eliminates read-modify-write race conditions under simultaneous concurrency.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();

  constructor() {
    if (typeof setInterval !== 'undefined') {
      const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
          entry.timestamps = entry.timestamps.filter((t) => now - t < 300000);
          if (entry.timestamps.length === 0) {
            this.store.delete(key);
          }
        }
      }, 300000);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }
  }

  get(key: string): number[] {
    const entry = this.store.get(key);
    return entry ? entry.timestamps : [];
  }

  set(key: string, timestamps: number[]): void {
    this.store.set(key, { timestamps });
  }

  checkAndRecord(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // Atomic filter & window validation
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= limit) {
      const oldest = entry.timestamps[0];
      const resetMs = Math.max(0, windowMs - (now - oldest));
      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    }

    entry.timestamps.push(now);
    return {
      allowed: true,
      remaining: limit - entry.timestamps.length,
      resetMs: windowMs,
    };
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Upstash Redis / Managed HTTP Rate Limit Store.
 * Provides distributed, durable atomic sliding window limits across serverless and multi-instance nodes.
 */
export class UpstashRedisRateLimitStore implements RateLimitStore {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async get(key: string): Promise<number[]> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['GET', key]),
      });
      if (!res.ok) return [];
      const json = await res.json();
      if (json.result && typeof json.result === 'string') {
        return JSON.parse(json.result);
      }
      return Array.isArray(json.result) ? json.result : [];
    } catch {
      return [];
    }
  }

  async ping(timeoutMs = 2000): Promise<boolean> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['PING']),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return false;
      const json = await res.json();
      return json.result === 'PONG';
    } catch {
      return false;
    }
  }

  async set(key: string, timestamps: number[]): Promise<void> {
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['SET', key, JSON.stringify(timestamps), 'EX', 300]),
      });
    } catch {
      // Gracefully continue
    }
  }

  async checkAndRecord(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const uniqueMember = `${now}-${Math.random().toString(36).slice(2, 9)}`;

    // Atomic sliding window Lua script
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local member = ARGV[4]
      local clearBefore = now - window
      redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)
      local current = redis.call('ZCARD', key)
      if current < limit then
        redis.call('ZADD', key, now, member)
        redis.call('EXPIRE', key, math.ceil(window / 1000) + 2)
        return {1, limit - current - 1, window}
      else
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local resetMs = window
        if oldest and #oldest >= 2 then
          resetMs = math.max(0, window - (now - tonumber(oldest[2])))
        end
        return {0, 0, resetMs}
      end
    `;

    try {
      const res = await fetch(`${this.url}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          'EVAL',
          luaScript,
          1,
          key,
          String(now),
          String(windowMs),
          String(limit),
          uniqueMember,
        ]),
      });

      if (!res.ok) {
        throw new Error(`Upstash returned HTTP status ${res.status}`);
      }

      const json = await res.json();
      if (Array.isArray(json.result) && json.result.length >= 3) {
        const allowed = Number(json.result[0]) === 1;
        const remaining = Number(json.result[1]);
        const resetMs = Number(json.result[2]);
        return { allowed, remaining, resetMs };
      }

      throw new Error('Unexpected format in Redis EVAL response');
    } catch (providerError) {
      // Endpoint policy:
      // 1. Critical authentication mutations (auth:login, auth:signup, auth:refresh) MUST fail closed in production
      //    to prevent brute-force attacks and credential stuffing during Redis degradation.
      //    Crucially, setting RATE_LIMIT_FAIL_CLOSED=false for emergency non-auth recovery CANNOT accidentally
      //    weaken authentication protections.
      // 2. Non-auth endpoints (e.g. cothink, stream, sessions) default to fail-closed in production unless
      //    operators explicitly configure RATE_LIMIT_FAIL_CLOSED=false for emergency degraded in-memory availability.
      const isProduction = process.env.NODE_ENV === 'production';
      const isAuthEndpoint = key.startsWith('auth:');
      const failClosedExplicit = process.env.RATE_LIMIT_FAIL_CLOSED;

      let shouldFailClosed = false;
      if (isAuthEndpoint && isProduction) {
        // Critical authentication endpoints UNCONDITIONALLY fail closed in production
        // to prevent brute-force attacks and credential stuffing during Redis degradation.
        // No emergency availability override is permitted to weaken authentication security.
        shouldFailClosed = true;
      } else if (failClosedExplicit === 'true') {
        shouldFailClosed = true;
      } else if (failClosedExplicit === 'false') {
        // Operators explicitly turned off fail-closed for non-auth endpoints
        shouldFailClosed = false;
      } else if (isProduction) {
        shouldFailClosed = true;
      }

      if (shouldFailClosed) {
        await emitOperatorAlertAsync('REDIS_OUTAGE', {
          key,
          action: 'FAIL_CLOSED_REJECT',
          isAuthEndpoint,
          error: providerError instanceof Error ? providerError.message : String(providerError),
          runbook: isAuthEndpoint
            ? 'Check Upstash Redis status immediately. Auth endpoints remain strictly fail-closed to prevent credential abuse.'
            : 'Check Upstash Redis status. For emergency degraded availability on non-auth routes, set RATE_LIMIT_FAIL_CLOSED=false.',
        });
        return {
          allowed: false,
          remaining: 0,
          resetMs: windowMs,
          unavailable: true,
        };
      }

      await emitOperatorAlertAsync('REDIS_OUTAGE', {
        key,
        action: 'DEGRADED_MEMORY_FALLBACK',
        isAuthEndpoint,
        error: providerError instanceof Error ? providerError.message : String(providerError),
        runbook: 'Engaged per-node in-memory sliding window fallback. Monitor node memory and restore Redis connectivity.',
      });
      return memoryStore.checkAndRecord(key, limit, windowMs);
    }
  }
}

const memoryStore = new MemoryRateLimitStore();

/**
 * Emits a structured, high-visibility operator alert to console.error
 * and outbound webhooks for logging aggregators (Datadog, CloudWatch, Slack, PagerDuty).
 */
export function emitOperatorAlert(
  alertType: 'CONFIG_MISSING' | 'REDIS_OUTAGE' | 'CONFIG_INVALID',
  details: Record<string, unknown>
): void {
  void reportOperationalAlertAsync(alertType, details).catch(() => {
    reportOperationalAlert(alertType, details);
  });
}

/**
 * Emits a structured, high-visibility operator alert asynchronously
 * with distributed Redis deduplication guarantees across cluster instances.
 */
export async function emitOperatorAlertAsync(
  alertType: 'CONFIG_MISSING' | 'REDIS_OUTAGE' | 'CONFIG_INVALID',
  details: Record<string, unknown>
): Promise<void> {
  await reportOperationalAlertAsync(alertType, details);
}

/**
 * Standardized error response for rate limiting across all API routes.
 * Differentiates HTTP 503 (infrastructure unavailable / fail-closed) from HTTP 429 (quota exceeded).
 */
export function createRateLimitErrorResponse(
  rateCheck: RateLimitResult,
  customQuotaMessage?: string
): NextResponse {
  const retryAfterSec = String(Math.max(1, Math.ceil((rateCheck.resetMs || 60000) / 1000)));
  if (rateCheck.unavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please retry shortly.' },
      {
        status: 503,
        headers: {
          'Retry-After': retryAfterSec,
        },
      }
    );
  }
  return NextResponse.json(
    { error: customQuotaMessage || 'Rate limit exceeded. Please wait before making more requests.' },
    {
      status: 429,
      headers: {
        'Retry-After': retryAfterSec,
      },
    }
  );
}

/**
 * Verifies production environment variables for rate limiting.
 * Returns health and configuration diagnostics for deployment readiness probes.
 * Never echoes secret or sensitive URL values in diagnostics.
 */
export function verifyRateLimiterConfig(options: { emitAlerts?: boolean } = {}): {
  valid: boolean;
  isProduction: boolean;
  hasUpstash: boolean;
  failClosedActive: boolean;
  authFailClosedActive: boolean;
  error?: string;
} {
  const emitAlerts = options.emitAlerts !== false;
  const isProduction = process.env.NODE_ENV === 'production';
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const hasUpstash = Boolean(upstashUrl && upstashToken);
  const failClosedActive =
    process.env.RATE_LIMIT_FAIL_CLOSED === 'true' ||
    (isProduction && process.env.RATE_LIMIT_FAIL_CLOSED !== 'false');
  // Authentication endpoints UNCONDITIONALLY fail closed in production. No override is permitted.
  const authFailClosedActive = isProduction;

  if (isProduction && !hasUpstash) {
    const errorMsg =
      'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured in production to enforce distributed rate limits.';
    if (emitAlerts) {
      emitOperatorAlert('CONFIG_MISSING', {
        error: errorMsg,
        recovery:
          'Provision Upstash Redis credentials or set RATE_LIMIT_FAIL_CLOSED=false for emergency degraded per-node memory limiting.',
      });
    }
    return { valid: false, isProduction, hasUpstash, failClosedActive, authFailClosedActive, error: errorMsg };
  }

  if (upstashUrl) {
    try {
      const parsed = new URL(upstashUrl);
      const allowedProtocols = isProduction ? ['https:'] : ['http:', 'https:'];
      if (!allowedProtocols.includes(parsed.protocol)) {
        throw new Error(isProduction ? 'Protocol must be https:' : 'Protocol must be http: or https:');
      }
    } catch (urlErr) {
      const reason = urlErr instanceof Error ? urlErr.message : 'Invalid URL structure';
      const errorMsg = `UPSTASH_REDIS_REST_URL is invalid (${reason})`;
      if (emitAlerts) emitOperatorAlert('CONFIG_INVALID', { error: errorMsg });
      return { valid: false, isProduction, hasUpstash, failClosedActive, authFailClosedActive, error: errorMsg };
    }
  }

  return { valid: true, isProduction, hasUpstash, failClosedActive, authFailClosedActive };
}

/**
 * Asynchronously verifies rate limiter configuration using distributed deduplication for alerts.
 * Useful for multi-instance startup checks when distributed alert deduplication is desired.
 */
export async function verifyRateLimiterConfigAsync(options: { emitAlerts?: boolean } = {}): Promise<ReturnType<typeof verifyRateLimiterConfig>> {
  const result = verifyRateLimiterConfig({ emitAlerts: false });
  if (!result.valid && options.emitAlerts !== false) {
    if (result.error?.includes('must be configured')) {
      await emitOperatorAlertAsync('CONFIG_MISSING', {
        error: result.error,
        recovery:
          'Provision Upstash Redis credentials or set RATE_LIMIT_FAIL_CLOSED=false for emergency degraded per-node memory limiting.',
      });
    } else {
      await emitOperatorAlertAsync('CONFIG_INVALID', { error: result.error || 'Configuration invalid' });
    }
  }
  return result;
}

/**
 * Resolves the active distributed store.
 * Prefers managed Redis (Upstash) when configured, falling back to atomic memory store.
 */
export function getActiveRateLimitStore(): RateLimitStore {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    return new UpstashRedisRateLimitStore(upstashUrl, upstashToken);
  }

  // In production, reject rate-limited API requests when distributed Redis credentials are missing
  // to prevent per-instance quota bypasses in serverless / multi-instance environments.
  if (process.env.NODE_ENV === 'production') {
    const isGeneralRecovery = process.env.RATE_LIMIT_FAIL_CLOSED === 'false';

    return {
      get: () => new Array(10000).fill(Date.now()),
      set: () => {},
      checkAndRecord: async (key: string, limit: number, windowMs: number) => {
        const isAuth = key.startsWith('auth:');
        if (isAuth) {
          // Authentication endpoints UNCONDITIONALLY fail closed in production
          await emitOperatorAlertAsync('CONFIG_MISSING', {
            action: 'AUTH_FAIL_CLOSED_REJECT',
            key,
            error: 'Authentication endpoints unconditionally fail closed in production during Redis outage.',
          });
          return {
            allowed: false,
            remaining: 0,
            resetMs: windowMs || 60000,
            unavailable: true,
          };
        }

        if (isGeneralRecovery) {
          return memoryStore.checkAndRecord(key, limit, windowMs);
        }

        await emitOperatorAlertAsync('CONFIG_MISSING', {
          action: 'FAIL_CLOSED_REJECT',
          key,
          error: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN missing in production.',
          recovery: 'Set Redis environment variables or configure RATE_LIMIT_FAIL_CLOSED=false for emergency recovery.',
        });
        return {
          allowed: false,
          remaining: 0,
          resetMs: windowMs || 60000,
          unavailable: true,
        };
      },
    };
  }

  return memoryStore;
}

/**
 * Asynchronous sliding-window rate limit checker supporting distributed and atomic stores.
 */
export async function checkRateLimitAsync(
  key: string,
  limit: number = 30,
  windowMs: number = 60000,
  store: RateLimitStore = getActiveRateLimitStore()
): Promise<RateLimitResult> {
  if (store.checkAndRecord) {
    return store.checkAndRecord(key, limit, windowMs);
  }

  const now = Date.now();
  const rawTimestamps = await Promise.resolve(store.get(key));
  const timestamps = (Array.isArray(rawTimestamps) ? rawTimestamps : []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  timestamps.push(now);
  await Promise.resolve(store.set(key, timestamps));

  return {
    allowed: true,
    remaining: limit - timestamps.length,
    resetMs: windowMs,
  };
}

/**
 * Synchronous sliding window rate limiter per key.
 * Per-process only: never use for authentication endpoints, which must call checkRateLimitAsync
 * so limits are shared across instances and survive restarts.
 */
export function checkRateLimit(
  key: string,
  limit: number = 30,
  windowMs: number = 60000,
  store: RateLimitStore = memoryStore
): RateLimitResult {
  if (key.startsWith('auth:') && process.env.NODE_ENV === 'production') {
    emitOperatorAlert('CONFIG_INVALID', {
      action: 'AUTH_FAIL_CLOSED_REJECT',
      key,
      error: 'Synchronous per-process checkRateLimit() called for an auth endpoint; use checkRateLimitAsync().',
    });
    return { allowed: false, remaining: 0, resetMs: windowMs, unavailable: true };
  }

  if (store.checkAndRecord) {
    const res = store.checkAndRecord(key, limit, windowMs);
    if ('then' in res) {
      // In synchronous mode if store returns promise, fallback to sync memory
      return memoryStore.checkAndRecord(key, limit, windowMs);
    }
    return res;
  }

  const now = Date.now();
  const rawTimestamps = store.get(key);
  const timestamps = (Array.isArray(rawTimestamps) ? rawTimestamps : []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  timestamps.push(now);
  store.set(key, timestamps);

  return {
    allowed: true,
    remaining: limit - timestamps.length,
    resetMs: windowMs,
  };
}

/**
 * Standards-compliant IPv4 and IPv6 parser and validator.
 * Correctly handles:
 * - Bracketed IPv6: [2001:db8::1], [2001:db8::1]:8080
 * - Compressed IPv6: 2001:db8::1, fe80::1, ::1, ::
 * - Full IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334
 * - IPv4-mapped IPv6: ::ffff:192.0.2.1
 * - IPv4 with or without port: 192.0.2.1:8080, 192.0.2.1
 * Rejects invalid IPs, malformed brackets, out-of-range ports, and garbage strings.
 */
export function parseAndValidateIp(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Bracketed IPv6: [2001:db8::1] or [2001:db8::1]:8080
  const bracketMatch = trimmed.match(/^\[([0-9a-fA-F:.]+)\](?::(\d+))?$/);
  if (bracketMatch) {
    const ip = bracketMatch[1];
    const port = bracketMatch[2];
    if (port !== undefined) {
      const p = parseInt(port, 10);
      if (p < 1 || p > 65535) return null;
    }
    return isIP(ip) === 6 ? ip : null;
  }

  // 2. IPv4 with optional port: 192.0.2.1:8080
  const ipv4WithPortMatch = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
  if (ipv4WithPortMatch) {
    const ip = ipv4WithPortMatch[1];
    const port = parseInt(ipv4WithPortMatch[2], 10);
    if (port < 1 || port > 65535) return null;
    return isIP(ip) === 4 ? ip : null;
  }

  // 3. Plain IPv4 or unbracketed IPv6
  const type = isIP(trimmed);
  if (type === 4 || type === 6) {
    return trimmed;
  }

  return null;
}

/**
 * Validates whether a candidate string is a syntactic IPv4 or IPv6 address.
 * Standards-compliant: supports compressed IPv6, bracketed formats, and ports.
 */
export function isValidIp(ip: string): boolean {
  return parseAndValidateIp(ip) !== null;
}

/**
 * Safely extracts client IP from request headers according to trusted proxy guidelines.
 * Respects TRUST_PROXY and TRUSTED_PROXY_HEADER to defend against client IP header spoofing.
 */
export function getClientIp(req: Request): string {
  const trustProxy = process.env.TRUST_PROXY !== 'false';
  const trustedHeader = process.env.TRUSTED_PROXY_HEADER?.toLowerCase();

  // If a specific trusted proxy header is explicitly configured, strictly use only that header
  if (trustedHeader) {
    const val = req.headers.get(trustedHeader)?.trim();
    if (val) {
      const parts = val
        .split(',')
        .map((p) => parseAndValidateIp(p.trim()))
        .filter((ip): ip is string => ip !== null);
      if (parts.length > 0) {
        const depth = Math.max(1, parseInt(process.env.TRUSTED_PROXY_DEPTH || '1', 10));
        const targetIndex = Math.max(0, parts.length - depth);
        return parts[targetIndex] || parts[parts.length - 1];
      }
    }
    return '127.0.0.1';
  }

  // If proxy trust is disabled, ignore client-supplied proxy headers to prevent spoofing
  if (!trustProxy) {
    return '127.0.0.1';
  }

  const proxyProvider = (process.env.TRUSTED_PROXY_PROVIDER || '').toLowerCase().trim();

  // 1. Vercel edge verified client IP: trusted when running on Vercel or proxyProvider is vercel
  if (proxyProvider === 'vercel' || Boolean(process.env.VERCEL)) {
    const vercelIp = req.headers.get('x-vercel-forwarded-for')?.trim();
    if (vercelIp) {
      const firstCandidate = vercelIp.split(',')[0].trim();
      const parsed = parseAndValidateIp(firstCandidate);
      if (parsed) {
        return parsed;
      }
    }
  }

  // 2. Cloudflare edge verified client IP: ONLY trust when explicitly configured or designated
  if (proxyProvider === 'cloudflare') {
    const cfConnectingIp = req.headers.get('cf-connecting-ip')?.trim();
    if (cfConnectingIp) {
      const parsed = parseAndValidateIp(cfConnectingIp);
      if (parsed) {
        return parsed;
      }
    }
  }

  // 3. Reverse proxy verified single IP: ONLY trust when explicitly configured for Nginx / custom proxy
  if (proxyProvider === 'nginx' || proxyProvider === 'custom') {
    const realIp = req.headers.get('x-real-ip')?.trim();
    if (realIp) {
      const parsed = parseAndValidateIp(realIp);
      if (parsed) {
        return parsed;
      }
    }
  }

  // 4. X-Forwarded-For:
  // When behind reverse proxies (Vercel, AWS ALB, Node cluster), each trusted proxy appends
  // the client IP to the end of the header list. The leftmost IPs can be spoofed by clients.
  // We inspect from the right based on TRUSTED_PROXY_DEPTH (default: 1) to select the true hop.
  // We do NOT trust unverified cf-connecting-ip or x-real-ip without explicit proxy provider configuration.
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const validIps = forwardedFor
      .split(',')
      .map((p) => parseAndValidateIp(p.trim()))
      .filter((ip): ip is string => ip !== null);
    if (validIps.length > 0) {
      const depth = Math.max(1, parseInt(process.env.TRUSTED_PROXY_DEPTH || '1', 10));
      const targetIndex = Math.max(0, validIps.length - depth);
      return validIps[targetIndex] || validIps[validIps.length - 1];
    }
  }

  // 5. In test/development only, allow x-real-ip or cf-connecting-ip as ergonomic fallback
  if (process.env.NODE_ENV !== 'production') {
    const fallbackVal = req.headers.get('x-real-ip')?.trim() || req.headers.get('cf-connecting-ip')?.trim();
    if (fallbackVal) {
      const parsed = parseAndValidateIp(fallbackVal);
      if (parsed) {
        return parsed;
      }
    }
  }

  return '127.0.0.1';
}
