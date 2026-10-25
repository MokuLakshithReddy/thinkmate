import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/services/db/supabase-client';
import { setAuthCookies } from '@/lib/server-auth';
import { readBoundedJson } from '@/lib/request-utils';
import { checkRateLimitAsync, getClientIp, createRateLimitErrorResponse } from '@/lib/rate-limiter';
import { checkAuthEntryCsrfOrForbidden } from '@/lib/csrf';

import { recordConsent } from '@/lib/legal';

const SignUpSchema = z.object({
  email: z.string().email('Please provide a valid email address').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  accepted_terms: z.literal(true, {
    message: 'You must accept the Terms and Privacy Policy.',
  }),
  age_confirmed: z.literal(true, {
    message: 'You must confirm you are 18 or older or have parental consent.',
  }),
});

export async function POST(req: NextRequest) {
  // Login CSRF defense: credential endpoints require same-origin JSON requests even without cookies
  const csrfError = checkAuthEntryCsrfOrForbidden(req);
  if (csrfError) {
    return csrfError;
  }

  const clientIp = getClientIp(req);
  const rateLimitResult = await checkRateLimitAsync(`auth:signup:${clientIp}`, 5, 60000);

  if (!rateLimitResult.allowed) {
    return createRateLimitErrorResponse(
      rateLimitResult,
      'Too many signup attempts. Please wait before trying again.'
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

    if (data.user?.id) {
      await recordConsent(data.user.id);
    }

    const session = data?.session;
    const user = data?.user
      ? { id: data.user.id, email: data.user.email }
      : null;
    const requiresEmailConfirmation = !session;

    const response = NextResponse.json({
      success: true,
      authenticated: !requiresEmailConfirmation,
      requiresEmailConfirmation,
      user,
      session: session
        ? {
            expires_at: session.expires_at,
          }
        : null,
      message: session
        ? 'Account created and signed in successfully'
        : 'Account created. Please check your email to confirm your account before signing in.',
    });

    if (session) {
      setAuthCookies(response, session);
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
