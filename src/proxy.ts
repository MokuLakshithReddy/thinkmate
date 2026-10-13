import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Middleware implementing per-request Cryptographic Nonce & Strict-Dynamic CSP.
 *
 * In CSP Level 3 browsers (Chrome, Firefox, Safari, Edge):
 * - 'strict-dynamic' instructs the browser to execute only scripts bearing the dynamic 'nonce-...'.
 * - It automatically disables and ignores 'unsafe-inline' and host sources for script elements.
 * - 'unsafe-inline' is only evaluated as an ignored fallback for legacy pre-CSP3 browsers.
 */
export function proxy(request: NextRequest) {
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
      source: '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
