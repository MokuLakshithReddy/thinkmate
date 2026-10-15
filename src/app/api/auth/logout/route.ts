import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookies, isSameOriginRequest, revokeUserSession, RevocationResult } from '@/lib/server-auth';

export async function POST(req: NextRequest) {
  // CSRF validation on state-changing logout
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed: request origin unauthorized' },
      { status: 403 }
    );
  }

  // Extract tokens if present to sign out upstream
  const token =
    req.cookies.get('thinkmate_auth_token')?.value ||
    req.cookies.get('sb-access-token')?.value ||
    (req.headers.get('authorization')?.startsWith('Bearer ')
      ? req.headers.get('authorization')?.slice(7).trim()
      : undefined);

  const refreshToken =
    req.cookies.get('thinkmate_refresh_token')?.value ||
    req.cookies.get('sb-refresh-token')?.value;

  const hasCredentials = Boolean(token || refreshToken);
  let revocation: RevocationResult = {
    success: true,
    upstreamRevoked: false,
    localCleared: true,
  };

  if (hasCredentials) {
    revocation = await revokeUserSession(token, refreshToken);
  }

  // Contract: Never report overall success if session tokens were provided but upstream
  // server-side revocation could not be confirmed.
  const overallSuccess = hasCredentials ? revocation.upstreamRevoked : true;
  const status = overallSuccess ? 200 : 502;

  const response = NextResponse.json(
    {
      success: overallSuccess,
      upstreamRevoked: revocation.upstreamRevoked,
      localCleared: true,
      message: revocation.upstreamRevoked
        ? 'Signed out and session revoked successfully'
        : hasCredentials
          ? 'Signed out locally, but upstream session revocation could not be confirmed'
          : 'Signed out locally (no active session credentials provided)',
      ...(revocation.error ? { upstreamError: revocation.error } : {}),
    },
    { status }
  );

  // Expire all auth and refresh cookies immediately across all cases
  clearAuthCookies(response);

  return response;
}
