import { NextRequest, NextResponse } from 'next/server';
import {
  isSameOriginRequest,
  refreshUserSession,
  setAuthCookies,
  clearAuthCookies,
} from '@/lib/server-auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { readBoundedJson } from '@/lib/request-utils';

export async function POST(req: NextRequest) {
  // CSRF verification: token refresh is a state-changing authentication mutation
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed: request origin unauthorized' },
      { status: 403 }
    );
  }

  // Rate limiting to prevent token brute-forcing
  const clientIp = getClientIp(req);
  const rateLimitResult = checkRateLimit(`auth:refresh:${clientIp}`, 20, 60000);
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
      const response = NextResponse.json(
        { error: error?.message || 'Session expired or refresh token revoked' },
        { status: 401 }
      );
      // Revoke invalid/expired ambient cookies
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
