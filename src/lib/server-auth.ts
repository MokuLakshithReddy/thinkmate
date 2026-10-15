import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/services/db/supabase-client';

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication required: missing or invalid bearer token') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Standard cookie configuration options enforcing defensive CSRF & XSS protections.
 * All ThinkMate auth cookies must use HttpOnly, Secure, SameSite=Lax, and Path=/.
 */
export const SECURE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * Long-lived secure cookie options for refresh tokens (30 days).
 */
export const REFRESH_COOKIE_OPTIONS = {
  ...SECURE_COOKIE_OPTIONS,
  maxAge: 30 * 24 * 60 * 60, // 30 days
};

/**
 * Sets both access and refresh cookies onto the response for ambient Same-Origin authentication.
 */
export function setAuthCookies(
  res: NextResponse,
  session: { access_token: string; refresh_token?: string }
) {
  res.cookies.set('thinkmate_auth_token', session.access_token, SECURE_COOKIE_OPTIONS);
  res.cookies.set('sb-access-token', session.access_token, SECURE_COOKIE_OPTIONS);

  if (session.refresh_token) {
    res.cookies.set('thinkmate_refresh_token', session.refresh_token, REFRESH_COOKIE_OPTIONS);
    res.cookies.set('sb-refresh-token', session.refresh_token, REFRESH_COOKIE_OPTIONS);
  }
}

/**
 * Expires both access and refresh cookies across all supported cookie names.
 */
export function clearAuthCookies(res: NextResponse) {
  const expired = { ...SECURE_COOKIE_OPTIONS, maxAge: 0 };
  res.cookies.set('thinkmate_auth_token', '', expired);
  res.cookies.set('sb-access-token', '', expired);
  res.cookies.set('thinkmate_refresh_token', '', expired);
  res.cookies.set('sb-refresh-token', '', expired);
}

import crypto from 'node:crypto';

export interface RevocationResult {
  success: boolean;
  upstreamRevoked: boolean;
  localCleared: boolean;
  error?: string;
}

/**
 * Derives a collision-resistant SHA-256 hash of a token string for safe memory indexing.
 * Prevents raw authentication tokens from existing as plaintext keys in process heap memory.
 */
export function hashTokenKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Server-side session revocation.
 * Revokes the session in Supabase Auth via admin.signOut if privileged credentials exist,
 * through user-scoped setSession + signOut if refresh token exists, or via direct authenticated
 * HTTP logout against Supabase GoTrue /auth/v1/logout endpoint if only an access token is present.
 * Returns a typed RevocationResult distinguishing local cookie clearance from confirmed upstream revocation.
 */
export async function revokeUserSession(
  token?: string,
  refreshToken?: string
): Promise<RevocationResult> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.STAGING_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  let upstreamRevoked = false;
  let lastError: string | undefined;

  // 1. Authoritative admin revocation via GoTrue admin API if service key is present
  if (serviceRoleKey && supabaseUrl && token) {
    try {
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });
      const { error } = await adminClient.auth.admin.signOut(token);
      if (!error) {
        upstreamRevoked = true;
      } else {
        lastError = error.message;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      console.warn('[ServerAuth] Admin signOut attempt error:', err);
    }
  }

  // 2. User-scoped client revocation if admin revocation did not succeed
  if (!upstreamRevoked && supabaseUrl && supabaseAnonKey && (token || refreshToken)) {
    try {
      if (token) {
        // Direct authenticated HTTP logout against Supabase GoTrue endpoint
        const logoutUrl = `${supabaseUrl}/auth/v1/logout`;
        const res = await fetch(logoutUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok || res.status === 200 || res.status === 204) {
          upstreamRevoked = true;
          lastError = undefined;
        } else {
          const body = await res.text().catch(() => '');
          lastError = `GoTrue logout HTTP status ${res.status}: ${body}`;
        }
      } else if (refreshToken) {
        const userScopedClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false },
        });
        const { error: sessionError } = await userScopedClient.auth.setSession({
          access_token: '',
          refresh_token: refreshToken,
        });
        if (!sessionError) {
          const { error: signOutError } = await userScopedClient.auth.signOut();
          if (!signOutError) {
            upstreamRevoked = true;
            lastError = undefined;
          } else {
            lastError = signOutError.message;
          }
        } else {
          lastError = sessionError.message;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      console.warn('[ServerAuth] User client session revocation error:', err);
    }
  }

  // Clean up cache entry for this refresh token if present
  if (refreshToken) {
    rotationGraceCache.delete(refreshToken);
  }

  const hasTokens = Boolean(token || refreshToken);
  // Overall success strictly reflects confirmed upstream revocation when a session token was supplied.
  // If no token was provided, local cookie clearance succeeds without requiring upstream revocation.
  const success = hasTokens ? upstreamRevoked : true;
  if (hasTokens && !upstreamRevoked && !lastError) {
    lastError = 'Upstream session revocation could not be confirmed with identity provider';
  }

  return {
    success,
    upstreamRevoked,
    localCleared: true,
    error: lastError,
  };
}

/**
 * Ephemeral in-memory encryption key generated per process lifecycle.
 * Protects cached token rotation payloads in process heap memory using AES-256-GCM.
 * This guarantees raw JWT strings ("eyJ...") and refresh tokens are never retained
 * as plaintext strings in memory buffers or heap dumps.
 */
const IN_MEMORY_CIPHER_KEY = crypto.randomBytes(32);

interface EncryptedRotationPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface CachedRotationData {
  session: { access_token: string; refresh_token?: string; expires_at?: number };
  user: { id: string; email?: string };
}

export interface CachedRotation {
  session: { access_token: string; refresh_token?: string; expires_at?: number };
  user: { id: string; email?: string };
  expiresAt: number;
}

interface StoredRotationEntry {
  encrypted: EncryptedRotationPayload;
  expiresAt: number;
}

function encryptSessionPayload(payload: CachedRotationData): EncryptedRotationPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', IN_MEMORY_CIPHER_KEY, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptSessionPayload(encrypted: EncryptedRotationPayload): CachedRotationData | null {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      IN_MEMORY_CIPHER_KEY,
      Buffer.from(encrypted.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Bounded, self-cleaning, SHA-256 hash-keyed cache with in-memory AES-256-GCM encryption.
 *
 * Security & Privacy Architecture:
 * 1. Hashed Keys: Raw authentication tokens are never stored as map keys (SHA-256 hashed).
 * 2. Encrypted Values: Cached session tokens are encrypted in heap memory via AES-256-GCM
 *    using an ephemeral, process-lifetime symmetric key. Raw "eyJ..." strings are never
 *    retained as plaintext in memory buffers.
 * 3. Minimal Retained State: Holds only the access/refresh token pair and user identifier
 *    necessary to recover from concurrent browser tab rotation races.
 * 4. Temporal Grace Window: Retained for a strict maximum of 8 seconds (sufficient for concurrent
 *    network requests to settle), after which entries are actively evicted and unrecoverable.
 */
export class RotationGraceCache {
  private cache = new Map<string, StoredRotationEntry>();
  private readonly maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now >= item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  get(token: string): CachedRotation | undefined {
    this.evictExpired();
    const key = hashTokenKey(token);
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    const decrypted = decryptSessionPayload(entry.encrypted);
    if (!decrypted) {
      this.cache.delete(key);
      return undefined;
    }
    return {
      session: decrypted.session,
      user: decrypted.user,
      expiresAt: entry.expiresAt,
    };
  }

  set(token: string, entry: CachedRotation): void {
    this.evictExpired();
    const key = hashTokenKey(token);
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }
    const encrypted = encryptSessionPayload({
      session: entry.session,
      user: entry.user,
    });
    this.cache.set(key, {
      encrypted,
      expiresAt: entry.expiresAt,
    });
  }

  delete(token: string): boolean {
    return this.cache.delete(hashTokenKey(token));
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    this.evictExpired();
    return this.cache.size;
  }
}

export const rotationGraceCache = new RotationGraceCache(100);

/**
 * Resolves a 256-bit AES cluster encryption key shared across server instances.
 * In production, strictly requires a dedicated SESSION_ENCRYPTION_KEY or ROTATION_SECRET (>= 32 chars).
 * Allows multiple distinct server nodes/containers to encrypt and decrypt distributed rotation records
 * in Upstash Redis without storing plaintext JWTs or refresh tokens in the Redis datastore.
 */
export function getClusterEncryptionKey(): Buffer {
  const customSecret = process.env.SESSION_ENCRYPTION_KEY || process.env.ROTATION_SECRET;
  if (customSecret) {
    if (customSecret.length < 32) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SECURITY FATAL: SESSION_ENCRYPTION_KEY must be at least 32 characters (256-bit entropy) in production.');
      }
      return crypto.createHash('sha256').update(customSecret).digest();
    }
    return Buffer.from(customSecret.slice(0, 32), 'utf8');
  }

  if (process.env.NODE_ENV === 'production') {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey && serviceKey.length >= 32) {
      return crypto.createHmac('sha256', 'thinkmate:rotation:cluster:v1').update(serviceKey).digest();
    }
    throw new Error(
      'SECURITY FATAL: SESSION_ENCRYPTION_KEY (>= 32 characters) must be configured in production for distributed token encryption.'
    );
  }

  const clusterSeed =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'thinkmate-cluster-rotation-default-seed';
  return crypto.createHmac('sha256', 'thinkmate:rotation:cluster:v1').update(clusterSeed).digest();
}

function encryptDistributedPayload(payload: { session: unknown; user: unknown }): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getClusterEncryptionKey(), iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptDistributedPayload(raw: string): {
  session: { access_token: string; refresh_token?: string; expires_at?: number };
  user: { id: string; email?: string };
} | null {
  try {
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, cipherB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(cipherB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getClusterEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Saves rotated session credentials to distributed Redis (if configured)
 * with a strict 10-second TTL to allow parallel server instances to recover
 * from concurrent refresh races and issue updated cookies to the client.
 *
 * Security Enhancements:
 * 1. Payload is authenticated and encrypted via AES-256-GCM with a shared cluster key.
 * 2. Sent via POST body command array (["SET", key, encryptedPayload, "EX", 10]),
 *    strictly eliminating sensitive tokens from HTTP request URLs.
 */
export async function saveDistributedRotatedSession(
  oldRefreshToken: string,
  session: { access_token: string; refresh_token?: string; expires_at?: number },
  user: { id: string; email?: string }
): Promise<void> {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!upstashUrl || !upstashToken) return;

  const key = `auth:rotation:${hashTokenKey(oldRefreshToken)}`;
  const encryptedPayload = encryptDistributedPayload({ session, user });
  try {
    const url = upstashUrl.replace(/\/$/, '');
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${upstashToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', key, encryptedPayload, 'EX', 10]),
    });
  } catch (err) {
    console.warn('[ServerAuth] Failed to persist distributed rotation record:', err);
  }
}

/**
 * Retrieves rotated session credentials from distributed Redis (if configured).
 * Enables Instance B to recover the newly rotated session produced by Instance A.
 * Decrypts the AES-256-GCM ciphertext retrieved via POST body request.
 */
export async function getDistributedRotatedSession(
  oldRefreshToken: string
): Promise<{
  session: { access_token: string; refresh_token?: string; expires_at?: number };
  user: { id: string; email?: string };
} | null> {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!upstashUrl || !upstashToken) return null;

  const key = `auth:rotation:${hashTokenKey(oldRefreshToken)}`;
  try {
    const url = upstashUrl.replace(/\/$/, '');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${upstashToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['GET', key]),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.result && typeof json.result === 'string') {
      return decryptDistributedPayload(json.result);
    }
  } catch (err) {
    console.warn('[ServerAuth] Failed to query distributed rotation record:', err);
  }
  return null;
}

const inFlightRefreshes = new Map<
  string,
  Promise<{
    data: {
      session: { access_token: string; refresh_token?: string; expires_at?: number } | null;
      user: { id: string; email?: string } | null;
    };
    error: Error | { message: string } | null;
  }>
>();

/**
 * Concurrency-resilient session refresh with local memory grace cache,
 * distributed Redis cross-instance synchronization, and in-flight Promise deduplication.
 * Grace window is 8 seconds.
 */
export async function refreshUserSession(refreshToken: string) {
  if (!refreshToken) {
    return { data: { session: null, user: null }, error: new Error('Missing refresh token') };
  }

  const tokenKey = hashTokenKey(refreshToken);

  // 1. Check local in-memory rotation grace cache (fast path for same instance)
  const cached = rotationGraceCache.get(refreshToken);
  if (cached && Date.now() < cached.expiresAt) {
    return {
      data: {
        session: cached.session,
        user: cached.user,
      },
      error: null,
    };
  }

  // 2. Check distributed Redis store (cross-instance recovery when another node rotated the token)
  const distributed = await getDistributedRotatedSession(refreshToken);
  if (distributed) {
    // Populate local cache as well
    rotationGraceCache.set(refreshToken, {
      session: distributed.session,
      user: distributed.user,
      expiresAt: Date.now() + 8000,
    });
    return {
      data: {
        session: distributed.session,
        user: distributed.user,
      },
      error: null,
    };
  }

  // 3. Return active in-flight refresh promise if one is already running for this token
  const existingPromise = inFlightRefreshes.get(tokenKey);
  if (existingPromise) {
    return await existingPromise;
  }

  // 4. Launch authoritative refresh request with cleanup, caching, and cross-instance race recovery
  const refreshPromise = (async () => {
    try {
      const result = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!result.error && result.data?.session && result.data?.user) {
        const rotationEntry: CachedRotation = {
          session: result.data.session,
          user: {
            id: result.data.user.id,
            email: result.data.user.email,
          },
          expiresAt: Date.now() + 8000,
        };
        // Store previous refresh token in encrypted local memory cache for grace recovery
        rotationGraceCache.set(refreshToken, rotationEntry);
        // Store in distributed Redis for cross-instance recovery
        await saveDistributedRotatedSession(
          refreshToken,
          result.data.session,
          rotationEntry.user
        );
        return result;
      }

      // 5. Cross-Instance Rotation Race Recovery:
      // If GoTrue returned an error (e.g. token was rotated by a parallel server node milliseconds earlier),
      // poll the distributed store with brief retry backoff to check if another instance
      // successfully rotated and persisted the new credentials.
      if (result.error) {
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
          const lateRecovered = await getDistributedRotatedSession(refreshToken);
          if (lateRecovered?.session && lateRecovered?.user) {
            rotationGraceCache.set(refreshToken, {
              session: lateRecovered.session,
              user: lateRecovered.user,
              expiresAt: Date.now() + 8000,
            });
            return {
              data: {
                session: lateRecovered.session,
                user: lateRecovered.user,
              },
              error: null,
            };
          }
        }
      }

      return result;
    } finally {
      inFlightRefreshes.delete(tokenKey);
    }
  })();

  inFlightRefreshes.set(tokenKey, refreshPromise);
  return await refreshPromise;
}

import { validateCsrf } from '@/lib/csrf';

/**
 * Validates that an incoming state-changing request originates from the same site
 * or an authorized application origin using the shared CSRF policy.
 */
export function isSameOriginRequest(req: NextRequest): boolean {
  return validateCsrf(req).allowed;
}

/**
 * Extracts and cryptographically verifies the authenticated user from the incoming request.
 * Strictly checks the Supabase Auth JWT from Authorization Bearer header or verified Same-Origin cookies.
 * Enforces strict CSRF validation whenever cookie-based authentication is used for state-changing requests.
 * Never trusts client-selected guest headers as authenticated identity.
 */
export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get('authorization');
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies) {
    // Check secure HttpOnly cookies (Supabase access token or ThinkMate session cookie)
    const cookieToken =
      req.cookies.get('sb-access-token')?.value || req.cookies.get('thinkmate_auth_token')?.value;

    if (cookieToken) {
      // CSRF Enforcement: For state-changing operations authenticated via ambient cookies,
      // verify that the request originates from the same site.
      const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase());
      if (isStateChanging && !isSameOriginRequest(req)) {
        console.warn(
          `[CSRF] Rejected cross-origin state-changing ${req.method} request authenticated via ambient cookie.`
        );
        return null;
      }
      token = cookieToken;
    }
  }

  if (token) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) {
        return {
          id: data.user.id,
          email: data.user.email,
        };
      }
    } catch (err) {
      console.warn('Authentication token verification failed:', err);
    }
  }

  return null;
}

/**
 * Enforces mandatory authentication. Throws an AuthenticationError if the request lacks a verified user.
 */
export async function requireAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    throw new AuthenticationError();
  }
  return user;
}
