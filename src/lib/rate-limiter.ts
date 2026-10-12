export interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
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
      const res = await fetch(`${this.url}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${this.token}` },
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

  async set(key: string, timestamps: number[]): Promise<void> {
    try {
      await fetch(
        `${this.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(timestamps))}?EX=300`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
        }
      );
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
      // Degraded-mode policy:
      // If RATE_LIMIT_FAIL_CLOSED=true is configured, reject traffic during Redis outages to guarantee strict DDoS/quota enforcement.
      // Default: engages bounded local in-memory sliding window fallback per node instance to prevent availability outages while restricting individual node floods.
      const failClosed = process.env.RATE_LIMIT_FAIL_CLOSED === 'true';
      if (failClosed) {
        console.error(
          '[RateLimiter] Upstash Redis execution failed and RATE_LIMIT_FAIL_CLOSED is true. Rejecting request to fail closed:',
          providerError
        );
        return {
          allowed: false,
          remaining: 0,
          resetMs: windowMs,
        };
      }

      console.warn(
        '[RateLimiter] Upstash Redis execution failed. Engaging degraded in-memory sliding window fallback (per-node bounded):',
        providerError
      );
      return memoryStore.checkAndRecord(key, limit, windowMs);
    }
  }
}

const memoryStore = new MemoryRateLimitStore();

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
 */
export function checkRateLimit(
  key: string,
  limit: number = 30,
  windowMs: number = 60000,
  store: RateLimitStore = memoryStore
): RateLimitResult {
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
 * Prioritizes trusted edge headers (cf-connecting-ip, x-real-ip) over easily spoofed x-forwarded-for entries.
 */
export function getClientIp(req: Request): string {
  // 1. Cloudflare edge verified client IP
  const cfConnectingIp = req.headers.get('cf-connecting-ip')?.trim();
  if (cfConnectingIp && isValidIp(cfConnectingIp)) {
    return cfConnectingIp;
  }

  // 2. Reverse proxy verified single IP
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) {
    const cleanReal = realIp.replace(/:\d+$/, '');
    if (isValidIp(cleanReal)) {
      return cleanReal;
    }
  }

  // 3. X-Forwarded-For: find first valid syntactic IP
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map((p) => p.trim().replace(/:\d+$/, ''));
    for (const part of parts) {
      if (isValidIp(part)) {
        return part;
      }
    }
  }

  return '127.0.0.1';
}
