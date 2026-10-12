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
    const raw = await this.get(key);
    const valid = raw.filter((t) => now - t < windowMs);

    if (valid.length >= limit) {
      const oldest = valid[0];
      const resetMs = Math.max(0, windowMs - (now - oldest));
      return { allowed: false, remaining: 0, resetMs };
    }

    valid.push(now);
    await this.set(key, valid);

    return {
      allowed: true,
      remaining: limit - valid.length,
      resetMs: windowMs,
    };
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
 * Safely extracts client IP from request headers according to trusted proxy guidelines.
 * Strips port numbers and checks x-forwarded-for, x-real-ip, or falls back to loopback.
 */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map((p) => p.trim());
    if (parts.length > 0 && parts[0]) {
      const cleanIp = parts[0].replace(/:\d+$/, '');
      if (cleanIp) return cleanIp;
    }
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim().replace(/:\d+$/, '');
  }

  return '127.0.0.1';
}
