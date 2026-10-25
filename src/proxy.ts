import { NextRequest, NextResponse } from 'next/server';
import { checkCsrfOrForbidden } from '@/lib/csrf';

/**
 * Next.js Edge Proxy Middleware.
 *
 * Enforces two primary security layers:
 * 1. Global CSRF Protection:
 *    Inspects state-changing API mutations (/api/*) authenticated via ambient cookies,
 *    strictly verifying Same-Origin and Sec-Fetch-Site to prevent cross-site request forgery.
 *
 * 2. Per-Request Nonce & Strict-Dynamic CSP:
 *    For document/page requests, generates a cryptographic random base64 nonce.
 *    Sets the single authoritative Content-Security-Policy response header with
 *    'nonce-${nonce}' and 'strict-dynamic', ensuring only authorized framework and application
 *    scripts execute while preventing duplicate/conflicting static policies.
 */
export function proxy(request: NextRequest) {
  // 1. API Route Handling: Enforce CSRF protection on mutations (exempting signature-authenticated webhooks)
  if (request.nextUrl.pathname.startsWith('/api')) {
    if (request.nextUrl.pathname.startsWith('/api/billing/webhook')) {
      return NextResponse.next();
    }
    const csrfRejection = checkCsrfOrForbidden(request);
    if (csrfRejection) {
      return csrfRejection;
    }
    return NextResponse.next();
  }

  // 2. Page & Document Requests: Dynamic Nonce & Single Authoritative CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline';
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com data:;
    img-src 'self' data: https: blob:;
    connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com;
    worker-src 'self' blob:;
    object-src 'none';
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, ' ').trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('x-nonce', nonce);

  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
