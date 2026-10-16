import { NextRequest, NextResponse } from 'next/server';
import {
  isSameOriginRequest,
  refreshUserSession,
  setAuthCookies,
  clearAuthCookies,
  getAuthenticatedUser,
  getDistributedRotatedSession,
} from '@/lib/server-auth';
import { checkRateLimitAsync, getClientIp } from '@/lib/rate-limiter';
import { readBoundedJson } from '@/lib/request-utils';

export async function POST(req: NextRequest) {
  // CSRF verification: token refresh is a state-changing authentication mutation
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed: request origin unauthorized' },
      { status: 403 }
    );
  }

  // Rate limiting to prevent token brute-forcing (shared across instances via Upstash Redis)
  const clientIp = getClientIp(req);
  const rateLimitResult = await checkRateLimitAsync(`auth:refresh:${clientIp}`, 20, 60000);
  if (rateLimitResult.unavailable) {
    return NextResponse.json(
      { error: 'Authentication is temporarily unavailable. Please try again shortly.' },
      {
        status: 503,
        headers: {
          'Retry-After': String(Math.ceil(rateLimitResult.resetMs / 1000)),
        },
      }
    );
  }
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Too many token refresh requests. Please wait.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(rateLimitResult.resetMs / 1000)),
        },
      }
    );
  }

  // Extract refresh token from secure HttpOnly cookies or optional request payload
  let refreshToken =
    req.cookies.get('thinkmate_refresh_token')?.value ||
    req.cookies.get('sb-refresh-token')?.value;

  if (!refreshToken && req.headers.get('content-type')?.includes('application/json')) {
    const bodyResult = await readBoundedJson<{ refresh_token?: string }>(req, 4096);
    if (bodyResult.data?.refresh_token) {
      refreshToken = bodyResult.data.refresh_token;
    }
  }

  if (!refreshToken) {
    const response = NextResponse.json(
      { error: 'No refresh token provided' },
      { status: 401 }
    );
    clearAuthCookies(response);
    return response;
  }

  try {
    const { data, error } = await refreshUserSession(refreshToken);

    if (error || !data?.session || !data?.user) {
      // Cross-instance race recovery: another instance may have rotated this refresh token.
      // Only report success when we can hand the browser the rotated credentials.
      const recovered = await getDistributedRotatedSession(refreshToken);
      if (recovered?.session && recovered?.user) {
        const response = NextResponse.json({
          success: true,
          user: { id: recovered.user.id, email: recovered.user.email },
          message: 'Token refreshed via concurrent rotation recovery',
        });
        setAuthCookies(response, recovered.session);
        return response;
      }

      // Recovery impossible. If the access token is still valid, a concurrent response may already
      // have delivered fresh cookies, so do not clear them; but do not claim refresh succeeded either.
      const currentUser = await getAuthenticatedUser(req);
      if (currentUser) {
        return NextResponse.json(
          {
            error: 'Refresh token was already rotated and the new session could not be recovered',
            code: 'REFRESH_ROTATION_UNRECOVERABLE',
            sessionActive: true,
          },
          { status: 401 }
        );
      }

      const response = NextResponse.json(
        { error: error?.message || 'Session expired or refresh token revoked' },
        { status: 401 }
      );
      clearAuthCookies(response);
      return response;
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      message: 'Token refreshed successfully',
    });

    // Rotate refresh token and update access token in secure HttpOnly cookies
    setAuthCookies(response, data.session);

    return response;
  } catch (err) {
    console.error('[Auth Refresh] Unexpected token rotation failure:', err);
    const response = NextResponse.json(
      { error: 'An unexpected token refresh error occurred' },
      { status: 500 }
    );
    return response;
  }
}
