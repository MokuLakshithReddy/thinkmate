import { NextRequest, NextResponse } from 'next/server';

export interface CsrfValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Resolves the canonical allowed origins and hostnames from environment configuration.
 *
 * Recognized sources:
 * - APP_URL: Canonical application URL (e.g. "https://thinkmate.ai")
 * - NEXT_PUBLIC_APP_URL: Client-exposed application URL (e.g. "http://localhost:3000")
 * - TRUSTED_ORIGINS: Comma-separated list of trusted origins or host aliases (e.g. "https://thinkmate.app,https://staging.thinkmate.app")
 * - VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL: Platform production hostnames
 */
export function getAllowedAppOrigins(): { origins: Set<string>; hosts: Set<string> } {
  const origins = new Set<string>();
  const hosts = new Set<string>();

  const candidates: (string | undefined)[] = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  if (process.env.TRUSTED_ORIGINS) {
    const split = process.env.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
    candidates.push(...split);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const urlStr = candidate.includes('://') ? candidate : `https://${candidate}`;
      const parsed = new URL(urlStr);
      origins.add(parsed.origin.toLowerCase());
      hosts.add(parsed.host.toLowerCase());
    } catch {
      // Ignore unparseable entries
    }
  }

  return { origins, hosts };
}

/**
 * Validates cross-origin state-changing mutations under ambient cookie authentication.
 *
 * Defense-in-depth rules:
 * 1. Read-only methods (GET, HEAD, OPTIONS) are exempt from CSRF checks.
 * 2. Requests using explicit Authorization headers (Bearer tokens) are not ambient credentials
 *    and cannot be forged cross-site without script execution on the victim origin; they are allowed.
 * 3. When authentication relies on ambient cookies (e.g. sb-access-token, thinkmate_auth_token):
 *    - Sec-Fetch-Site: If present and equals 'cross-site', reject immediately (403 Forbidden).
 *    - Request Host: Must be present. If missing, reject immediately (403 Forbidden).
 *    - Origin / Referer: Must be a valid URL whose origin/host matches:
 *        a. The incoming request's Host header (Same-Origin), OR
 *        b. The canonical configured application origin (APP_URL, NEXT_PUBLIC_APP_URL, TRUSTED_ORIGINS).
 *    - Untrusted proxy headers (e.g. spoofed X-Forwarded-Host) are never used to authorize cross-origin requests.
 *    - Missing or malformed Origin AND Referer on a cookie-authenticated state-changing mutation is rejected (403 Forbidden).
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

  // 1. Sec-Fetch-Site check
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') {
    return {
      allowed: false,
      reason: 'CSRF violation: Sec-Fetch-Site is cross-site for cookie-authenticated mutation',
    };
  }

  // 2. Validate request Host header
  const host = req.headers.get('host');
  if (!host) {
    return { allowed: false, reason: 'CSRF violation: missing Host header' };
  }
  const normalizedHost = host.toLowerCase();

  // Resolve canonical configured origins
  const { origins: allowedOrigins, hosts: allowedHosts } = getAllowedAppOrigins();

  // 3. Validate Origin header
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      // Origin must be HTTP or HTTPS
      if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
        return { allowed: false, reason: `CSRF violation: invalid Origin protocol "${originUrl.protocol}"` };
      }

      const originHost = originUrl.host.toLowerCase();
      const originOrigin = originUrl.origin.toLowerCase();

      // Check against request Host OR configured canonical application origins / aliases
      if (
        originHost === normalizedHost ||
        allowedHosts.has(originHost) ||
        allowedOrigins.has(originOrigin)
      ) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: `CSRF violation: origin "${origin}" does not match host "${host}" or configured application origins`,
      };
    } catch {
      return { allowed: false, reason: 'CSRF violation: invalid Origin header URL' };
    }
  }

  // 4. Fallback to Referer header if Origin is not supplied
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.protocol !== 'http:' && refererUrl.protocol !== 'https:') {
        return { allowed: false, reason: `CSRF violation: invalid Referer protocol "${refererUrl.protocol}"` };
      }

      const refererHost = refererUrl.host.toLowerCase();
      const refererOrigin = refererUrl.origin.toLowerCase();

      if (
        refererHost === normalizedHost ||
        allowedHosts.has(refererHost) ||
        allowedOrigins.has(refererOrigin)
      ) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: `CSRF violation: referer "${referer}" does not match host "${host}" or configured application origins`,
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
