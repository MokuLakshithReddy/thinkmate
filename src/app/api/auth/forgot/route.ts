import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/services/db/supabase-client';
import { readBoundedJson } from '@/lib/request-utils';
import { checkRateLimitAsync, getClientIp, createRateLimitErrorResponse } from '@/lib/rate-limiter';
import { checkAuthEntryCsrfOrForbidden } from '@/lib/csrf';

const Body = z.object({ email: z.string().email().max(100) });
const GENERIC = { message: 'If an account exists for that email, a reset link is on its way.' };
const HOUR = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const csrf = checkAuthEntryCsrfOrForbidden(req);
  if (csrf) return csrf;

  const ipLimit = await checkRateLimitAsync(`auth:forgot:ip:${getClientIp(req)}`, 5, HOUR);
  if (!ipLimit.allowed) {
    return createRateLimitErrorResponse(ipLimit, 'Too many reset requests. Try again later.');
  }

  const body = await readBoundedJson<Record<string, unknown>>(req, 4096);
  const parsed = Body.safeParse(body.data);
  if (!parsed.success) return NextResponse.json(GENERIC);

  const email = parsed.data.email.toLowerCase();
  const emailLimit = await checkRateLimitAsync(`auth:forgot:email:${email}`, 3, HOUR);
  if (emailLimit.allowed) {
    const origin = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    });
  }

  return NextResponse.json(GENERIC);
}
