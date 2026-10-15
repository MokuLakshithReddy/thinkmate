import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/services/db/supabase-client';
import { SECURE_COOKIE_OPTIONS } from '@/lib/server-auth';
import { readBoundedJson } from '@/lib/request-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';

const SignUpSchema = z.object({
  email: z.string().email('Please provide a valid email address').max(100),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
});

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const rateLimitResult = checkRateLimit(`auth:signup:${clientIp}`, 5, 60000);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Too many signup attempts. Please wait before trying again.' },
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

  const parsed = SignUpSchema.safeParse(bodyResult.data);
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Signup failed' },
        { status: 400 }
      );
    }

    const session = data?.session;
    const user = data?.user
      ? { id: data.user.id, email: data.user.email }
      : null;

    const response = NextResponse.json({
      success: true,
      user,
      message: session
        ? 'Account created and signed in successfully'
        : 'Account created. Please check your email to confirm your account.',
    });

    if (session?.access_token) {
      response.cookies.set('thinkmate_auth_token', session.access_token, SECURE_COOKIE_OPTIONS);
      response.cookies.set('sb-access-token', session.access_token, SECURE_COOKIE_OPTIONS);
    }

    return response;
  } catch (err) {
    console.error('[Auth SignUp] Unexpected failure:', err);
    return NextResponse.json(
      { error: 'An unexpected signup error occurred' },
      { status: 500 }
    );
  }
}
