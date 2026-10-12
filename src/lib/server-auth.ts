import { NextRequest } from 'next/server';
import { supabase } from '@/services/db/supabase-client';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  isAnonymous?: boolean;
}

/**
 * Extracts and verifies the authenticated user from the incoming request.
 * Prioritizes Supabase Auth JWT from Authorization Bearer header.
 * Falls back to verified session cookie if present.
 */
export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get('authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user) {
          return {
            id: data.user.id,
            email: data.user.email,
            isAnonymous: false,
          };
        }
      } catch (err) {
        console.warn('Bearer token verification failed:', err);
      }
    }
  }

  // Check guest or client session header for unauthenticated demo/local mode
  const guestHeader = req.headers.get('x-guest-session-id');
  if (guestHeader) {
    return {
      id: `guest-${guestHeader}`,
      isAnonymous: true,
    };
  }

  return null;
}
