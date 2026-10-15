import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedUser,
  refreshUserSession,
  setAuthCookies,
  clearAuthCookies,
} from '@/lib/server-auth';

export async function GET(req: NextRequest) {
  // 1. Check if access token is currently valid
  const user = await getAuthenticatedUser(req);
  if (user) {
    return NextResponse.json({
      authenticated: true,
      user,
    });
  }

  // 2. If access token is expired or missing, check for a refresh token cookie
  const refreshToken =
    req.cookies.get('thinkmate_refresh_token')?.value ||
    req.cookies.get('sb-refresh-token')?.value;

  if (refreshToken) {
    try {
      const { data, error } = await refreshUserSession(refreshToken);
      if (!error && data?.session && data?.user) {
        const response = NextResponse.json({
          authenticated: true,
          user: {
            id: data.user.id,
            email: data.user.email,
          },
        });
        // Rotate tokens and set updated HttpOnly cookies
        setAuthCookies(response, data.session);
        return response;
      }
    } catch (err) {
      console.warn('[Auth Session] Automatic silent refresh failed:', err);
    }

    // Refresh failed or revoked: clear stale cookies
    const response = NextResponse.json({
      authenticated: false,
      user: null,
    });
    clearAuthCookies(response);
    return response;
  }

  return NextResponse.json({
    authenticated: false,
    user: null,
  });
}
