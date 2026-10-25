import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/services/db/supabase-client';
import { adminClient } from '@/lib/supabase-admin';
import { readBoundedJson } from '@/lib/request-utils';
import { checkRateLimitAsync, getClientIp, createRateLimitErrorResponse } from '@/lib/rate-limiter';
import { checkAuthEntryCsrfOrForbidden } from '@/lib/csrf';

const Body = z.object({
  access_token: z.string().min(20).max(4000),
  password: z.string().min(8).max(100),
});

export async function POST(req: NextRequest) {
  const csrf = checkAuthEntryCsrfOrForbidden(req);
  if (csrf) return csrf;

  const limit = await checkRateLimitAsync(`auth:reset:ip:${getClientIp(req)}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return createRateLimitErrorResponse(limit, 'Too many attempts. Try again later.');
  }

  const body = await readBoundedJson<Record<string, unknown>>(req, 8192);
  const parsed = Body.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const { data, error } = await supabase.auth.getUser(parsed.data.access_token);
  if (error || !data.user) {
    return NextResponse.json({ error: 'link_expired' }, { status: 401 });
  }

  const admin = adminClient();
  const { error: upErr } = await admin.auth.admin.updateUserById(data.user.id, {
    password: parsed.data.password,
  });

  if (upErr) {
    return NextResponse.json({ error: 'reset_failed' }, { status: 400 });
  }

  await admin.auth.admin.signOut(parsed.data.access_token, 'global').catch(() => undefined);
  return NextResponse.json({ message: 'Password updated. Please sign in.' });
}
