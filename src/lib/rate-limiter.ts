import { reportOperationalAlert } from '@/lib/monitoring';

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
        emitOperatorAlert('REDIS_OUTAGE', {
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

      emitOperatorAlert('REDIS_OUTAGE', {
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
  reportOperationalAlert(alertType, details);
}

/**
 * Verifies production environment variables for rate limiting.
 * Returns health and configuration diagnostics for deployment readiness probes.
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
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Protocol must be http: or https:');
      }
    } catch (urlErr) {
      const errorMsg = `UPSTASH_REDIS_REST_URL is invalid: ${upstashUrl} (${urlErr instanceof Error ? urlErr.message : String(urlErr)})`;
      if (emitAlerts) emitOperatorAlert('CONFIG_INVALID', { error: errorMsg });
      return { valid: false, isProduction, hasUpstash, failClosedActive, authFailClosedActive, error: errorMsg };
    }
  }

  return { valid: true, isProduction, hasUpstash, failClosedActive, authFailClosedActive };
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
      checkAndRecord: (key: string, limit: number, windowMs: number) => {
        const isAuth = key.startsWith('auth:');
        if (isAuth) {
          // Authentication endpoints UNCONDITIONALLY fail closed in production
          emitOperatorAlert('CONFIG_MISSING', {
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

        emitOperatorAlert('CONFIG_MISSING', {
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
  if (key.startsWith('auth:') && store === memoryStore && process.env.NODE_ENV === 'production') {
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
 * Validates whether a candidate string is a syntactic IPv4 or IPv6 address.
 */
function isValidIp(ip: string): boolean {
  const ipv4Regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
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
      const parts = val.split(',').map((p) => p.trim().replace(/:\d+$/, '')).filter(isValidIp);
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

  // 1. Cloudflare edge verified client IP: ONLY trust when explicitly configured or designated
  if (proxyProvider === 'cloudflare') {
    const cfConnectingIp = req.headers.get('cf-connecting-ip')?.trim();
    if (cfConnectingIp && isValidIp(cfConnectingIp)) {
      return cfConnectingIp;
    }
  }

  // 2. Reverse proxy verified single IP: ONLY trust when explicitly configured for Nginx / custom proxy
  if (proxyProvider === 'nginx' || proxyProvider === 'custom') {
    const realIp = req.headers.get('x-real-ip')?.trim();
    if (realIp) {
      const cleanReal = realIp.replace(/:\d+$/, '');
      if (isValidIp(cleanReal)) {
        return cleanReal;
      }
    }
  }

  // 3. X-Forwarded-For:
  // When behind reverse proxies (Vercel, AWS ALB, Node cluster), each trusted proxy appends
  // the client IP to the end of the header list. The leftmost IPs can be spoofed by clients.
  // We inspect from the right based on TRUSTED_PROXY_DEPTH (default: 1) to select the true hop.
  // We do NOT trust unverified cf-connecting-ip or x-real-ip without explicit proxy provider configuration.
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const validIps = forwardedFor
      .split(',')
      .map((p) => p.trim().replace(/:\d+$/, ''))
      .filter(isValidIp);
    if (validIps.length > 0) {
      const depth = Math.max(1, parseInt(process.env.TRUSTED_PROXY_DEPTH || '1', 10));
      const targetIndex = Math.max(0, validIps.length - depth);
      return validIps[targetIndex] || validIps[validIps.length - 1];
    }
  }

  // 4. In test/development only, allow x-real-ip or cf-connecting-ip as ergonomic fallback
  if (process.env.NODE_ENV !== 'production') {
    const fallbackReal = req.headers.get('x-real-ip')?.trim().replace(/:\d+$/, '') || req.headers.get('cf-connecting-ip')?.trim();
    if (fallbackReal && isValidIp(fallbackReal)) {
      return fallbackReal;
    }
  }

  return '127.0.0.1';
}
