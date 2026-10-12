export interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimitStore {
  get(key: string): Promise<number[]> | number[];
  set(key: string, timestamps: number[]): Promise<void> | void;
}

class MemoryRateLimitStore implements RateLimitStore {
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
}

const defaultStore: RateLimitStore = new MemoryRateLimitStore();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Sliding window rate limiter per key (IP, user ID, or session ID).
 * @param key Identifier for the client or user
 * @param limit Maximum allowed requests within the window
 * @param windowMs Window duration in milliseconds (e.g. 60000 for 1 minute)
 * @param store Optional pluggable store for distributed setups (e.g. Redis / Supabase)
 */
export function checkRateLimit(
  key: string,
  limit: number = 30,
  windowMs: number = 60000,
  store: RateLimitStore = defaultStore
): RateLimitResult {
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
    // In typical reverse-proxy setups (Vercel, Cloudflare, AWS ALB),
    // the first comma-separated address is the client's public IP.
    const parts = forwardedFor.split(',').map((p) => p.trim());
    if (parts.length > 0 && parts[0]) {
      const cleanIp = parts[0].replace(/:\d+$/, ''); // strip port if present
      if (cleanIp) return cleanIp;
    }
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim().replace(/:\d+$/, '');
  }

  return '127.0.0.1';
}
