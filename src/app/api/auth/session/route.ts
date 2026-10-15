import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/server-auth';

/**
 * Pure read-only session inspection route.
 * Strictly adheres to HTTP GET semantics: does NOT rotate tokens or modify cookies.
 * If the access token has expired but a refresh token cookie is present, returns
 * `canRefresh: true`, signaling to the client that it should invoke the dedicated,
 * CSRF-protected POST /api/auth/refresh route.
 */
export async function GET(req: NextRequest) {
  // 1. Check if access token is currently valid
  const user = await getAuthenticatedUser(req);
  if (user) {
    return NextResponse.json({
      authenticated: true,
      canRefresh: false,
      user,
    });
  }

  // 2. If access token is expired or missing, check if a refresh token cookie exists
  const refreshToken =
    req.cookies.get('thinkmate_refresh_token')?.value ||
    req.cookies.get('sb-refresh-token')?.value;

  if (refreshToken) {
    return NextResponse.json({
      authenticated: false,
      canRefresh: true,
      user: null,
    });
  }

  return NextResponse.json({
    authenticated: false,
    canRefresh: false,
    user: null,
  });
}
