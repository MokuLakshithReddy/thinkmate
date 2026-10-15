import { NextRequest, NextResponse } from 'next/server';
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

/**
 * Refreshes an expired session using the Supabase Auth refresh token.
 * Rotates the refresh token and returns the new session credentials.
 */
export async function refreshUserSession(refreshToken: string) {
  return await supabase.auth.refreshSession({ refresh_token: refreshToken });
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
