import { NextRequest } from 'next/server';
import { supabase } from '@/services/db/supabase-client';

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication required: missing or invalid bearer token') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Extracts and cryptographically verifies the authenticated user from the incoming request.
 * Strictly checks the Supabase Auth JWT from Authorization Bearer header.
 * Never trusts client-selected guest headers as authenticated identity.
 */
export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get('authorization');
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies) {
    // Check secure HttpOnly cookies (Supabase access token or ThinkMate session cookie)
    token = req.cookies.get('sb-access-token')?.value || req.cookies.get('thinkmate_auth_token')?.value;
  }

  if (token) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) {
        return {
          id: data.user.id,
          email: data.user.email,
        };
      }
    } catch (err) {
      console.warn('Authentication token verification failed:', err);
    }
  }

  return null;
}

/**
 * Enforces mandatory authentication. Throws an AuthenticationError if the request lacks a verified user.
 */
export async function requireAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    throw new AuthenticationError();
  }
  return user;
}
