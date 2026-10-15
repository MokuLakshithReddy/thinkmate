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

  if (token) {
    await revokeUserSession(token, refreshToken);
  }

  const response = NextResponse.json({
    success: true,
    message: 'Signed out successfully',
  });

  // Expire all auth and refresh cookies immediately
  clearAuthCookies(response);

  return response;
}
