import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/services/db/supabase-client';
import { setAuthCookies } from '@/lib/server-auth';
import { readBoundedJson } from '@/lib/request-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';

const LoginSchema = z.object({
  email: z.string().email('Please provide a valid email address').max(100),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
});

export async function POST(req: NextRequest) {
  // Rate limiting to prevent credential brute-forcing
  const clientIp = getClientIp(req);
  const rateLimitResult = checkRateLimit(`auth:login:${clientIp}`, 10, 60000);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please wait before trying again.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(rateLimitResult.resetMs / 1000)),
        },
      }
    );
  }

  const bodyResult = await readBoundedJson<Record<string, unknown>>(req, 16384);
  if (bodyResult.error || !bodyResult.data) {
    return NextResponse.json(
      { error: bodyResult.error || 'Invalid or missing JSON payload' },
      { status: bodyResult.status || 400 }
    );
  }

  const parsed = LoginSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data?.session) {
      return NextResponse.json(
        { error: error?.message || 'Invalid credentials' },
        { status: 401 }
      );
    }

    const user = {
      id: data.user.id,
      email: data.user.email,
    };

    const response = NextResponse.json({
      success: true,
      user,
      message: 'Signed in successfully',
    });

    // Set secure HttpOnly cookies for ambient Same-Origin authentication (access + refresh tokens)
    setAuthCookies(response, data.session);

    return response;
  } catch (err) {
    console.error('[Auth Login] Unexpected authentication failure:', err);
    return NextResponse.json(
      { error: 'An unexpected authentication error occurred' },
      { status: 500 }
    );
  }
}
