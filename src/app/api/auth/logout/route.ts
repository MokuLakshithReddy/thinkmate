import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/services/db/supabase-client';
import { clearAuthCookies, isSameOriginRequest } from '@/lib/server-auth';

export async function POST(req: NextRequest) {
  // CSRF validation on state-changing logout
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed: request origin unauthorized' },
      { status: 403 }
    );
  }

  // Extract token if present to sign out upstream
  const token =
    req.cookies.get('thinkmate_auth_token')?.value ||
    req.cookies.get('sb-access-token')?.value ||
    (req.headers.get('authorization')?.startsWith('Bearer ')
      ? req.headers.get('authorization')?.slice(7).trim()
      : undefined);

  if (token) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[Auth Logout] Supabase signOut warning:', err);
    }
  }

  const response = NextResponse.json({
    success: true,
    message: 'Signed out successfully',
  });

  // Expire all auth and refresh cookies immediately
  clearAuthCookies(response);

  return response;
}
