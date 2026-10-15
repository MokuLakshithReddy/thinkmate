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

export interface RevocationResult {
  success: boolean;
  upstreamRevoked: boolean;
  localCleared: boolean;
  error?: string;
}

/**
 * Server-side session revocation.
 * Revokes the session in Supabase Auth via admin.signOut if privileged credentials exist,
 * or through an authenticated user-scoped client session termination.
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

  // 2. User-scoped client revocation if admin revocation did not succeed (e.g. invalid access token but valid refresh token)
  if (!upstreamRevoked && supabaseUrl && supabaseAnonKey && (token || refreshToken)) {
    try {
      const userScopedClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      });
      if (refreshToken) {
        const { error: sessionError } = await userScopedClient.auth.setSession({
          access_token: token || '',
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
      } else if (token) {
        const { error: signOutError } = await userScopedClient.auth.signOut();
        if (!signOutError) {
          upstreamRevoked = true;
          lastError = undefined;
        } else {
          lastError = signOutError.message;
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

  return {
    success: true,
    upstreamRevoked,
    localCleared: true,
    error: lastError,
  };
}

interface CachedRotation {
  session: { access_token: string; refresh_token?: string; expires_at?: number };
  user: { id: string; email?: string };
  expiresAt: number;
}

/**
 * Bounded, self-cleaning cache for token rotation grace periods.
 * Evicts expired entries on every access/mutation and limits total stored entries
 * to prevent memory leaks in long-running Node.js processes.
 */
export class RotationGraceCache {
  private cache = new Map<string, CachedRotation>();
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
    const entry = this.cache.get(token);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(token);
      return undefined;
    }
    return entry;
  }

  set(token: string, entry: CachedRotation): void {
    this.evictExpired();
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }
    this.cache.set(token, entry);
  }

  delete(token: string): boolean {
    return this.cache.delete(token);
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
 * Concurrency-resilient session refresh with in-flight Promise deduplication and a 15-second grace window.
 * Protects concurrent requests from multiple browser tabs or parallel API calls from race conditions
 * where one request rotates the token and an overlapping request fails and clears the session.
 */
export async function refreshUserSession(refreshToken: string) {
  if (!refreshToken) {
    return { data: { session: null, user: null }, error: new Error('Missing refresh token') };
  }

  // 1. Check if this token was recently rotated within the 15-second grace window
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

  // 2. Return active in-flight refresh promise if one is already running for this token
  const existingPromise = inFlightRefreshes.get(refreshToken);
  if (existingPromise) {
    return await existingPromise;
  }

  // 3. Launch single authoritative refresh request with cleanup and caching
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
          expiresAt: Date.now() + 15000,
        };
        rotationGraceCache.set(refreshToken, rotationEntry);
        if (result.data.session.refresh_token) {
          rotationGraceCache.set(result.data.session.refresh_token, rotationEntry);
        }
      }
      return result;
    } finally {
      inFlightRefreshes.delete(refreshToken);
    }
  })();

  inFlightRefreshes.set(refreshToken, refreshPromise);
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
