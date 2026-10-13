import { NextRequest, NextResponse } from 'next/server';

export interface CsrfValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validates cross-origin state-changing mutations under ambient cookie authentication.
 *
 * Rules:
 * 1. Read-only methods (GET, HEAD, OPTIONS) are exempt from CSRF checks.
 * 2. Requests using explicit Authorization headers (Bearer tokens) are not ambient credentials
 *    and cannot be forged cross-site without script execution on the victim origin; they are allowed.
 * 3. When authentication relies on ambient cookies (e.g. sb-access-token, thinkmate_auth_token):
 *    - Sec-Fetch-Site: If present and equals 'cross-site', reject immediately (403 Forbidden).
 *    - Origin / Referer: The origin host must match the request's Host header or configured APP_URL.
 *    - Missing Origin AND Referer on a cookie-authenticated state-changing mutation is rejected (403 Forbidden).
 */
export function validateCsrf(req: Request | NextRequest): CsrfValidationResult {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { allowed: true };
  }

  const authHeader = req.headers.get('authorization');
  // If request carries explicit Bearer token, it is not an ambient cookie request
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { allowed: true };
  }

  // Check if cookies are present
  const cookieHeader = req.headers.get('cookie') || '';
  const hasAuthCookie =
    cookieHeader.includes('sb-access-token') ||
    cookieHeader.includes('thinkmate_auth_token') ||
    (req instanceof NextRequest && (req.cookies.has('sb-access-token') || req.cookies.has('thinkmate_auth_token')));

  // If no auth cookie is attached, CSRF is not applicable to unauthenticated or token-based requests
  if (!hasAuthCookie) {
    return { allowed: true };
  }

  // At this point, the request is a state-changing mutation carrying ambient auth cookies
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite === 'cross-site') {
    return {
      allowed: false,
      reason: 'CSRF violation: Sec-Fetch-Site is cross-site for cookie-authenticated mutation',
    };
  }

  const host = req.headers.get('host');
  if (!host) {
    return { allowed: false, reason: 'CSRF violation: missing Host header' };
  }

  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (originHost === host.toLowerCase()) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `CSRF violation: origin "${origin}" does not match host "${host}"`,
      };
    } catch {
      return { allowed: false, reason: 'CSRF violation: invalid Origin header URL' };
    }
  }

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const refererHost = new URL(referer).host.toLowerCase();
      if (refererHost === host.toLowerCase()) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `CSRF violation: referer "${referer}" does not match host "${host}"`,
      };
    } catch {
      return { allowed: false, reason: 'CSRF violation: invalid Referer header URL' };
    }
  }

  // Neither Origin nor Referer provided on a cookie-authenticated state-changing mutation
  return {
    allowed: false,
    reason: 'CSRF violation: state-changing mutation with cookies requires Origin or Referer header',
  };
}

/**
 * Convenience helper to enforce CSRF validation in Next.js route handlers.
 * Returns a 403 Forbidden NextResponse if validation fails, or null if allowed.
 */
export function checkCsrfOrForbidden(req: Request | NextRequest): NextResponse | null {
  const result = validateCsrf(req);
  if (!result.allowed) {
    console.warn(`[CSRF] Blocked request: ${result.reason}`);
    return NextResponse.json(
      { error: 'Forbidden: CSRF protection validation failed', details: result.reason },
      { status: 403 }
    );
  }
  return null;
}
