import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookies, isSameOriginRequest, revokeUserSession } from '@/lib/server-auth';

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

  let revocation: { success: boolean; upstreamRevoked: boolean; error?: string } = {
    success: true,
    upstreamRevoked: false,
  };

  if (token || refreshToken) {
    revocation = await revokeUserSession(token, refreshToken);
  }

  const response = NextResponse.json({
    success: true,
    upstreamRevoked: revocation.upstreamRevoked,
    message: revocation.upstreamRevoked
      ? 'Signed out and session revoked successfully'
      : 'Signed out locally (upstream session expired or unrevoked)',
    ...(revocation.error ? { upstreamError: revocation.error } : {}),
  });

  // Expire all auth and refresh cookies immediately
  clearAuthCookies(response);

  return response;
}
