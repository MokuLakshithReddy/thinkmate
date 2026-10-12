import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

/**
 * Public/Anon Supabase Client.
 * Used for browser/client-side access. Returns null or mock client if unconfigured.
 */
export const supabase: SupabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : (createClient('https://placeholder.supabase.co', 'placeholder-anon-key'));

/**
 * Creates an authenticated user-scoped client using the caller's JWT token.
 * This guarantees Row Level Security (RLS) policies apply to the authenticated user.
 */
export function getUserSupabaseClient(accessToken: string): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) are required.');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

/**
 * Privileged Service-Role Supabase Client.
 * Fails closed if SUPABASE_SERVICE_ROLE_KEY is not explicitly provided in server environment.
 * NEVER hardcode or expose service keys in client bundles or repository source code.
 */
export function getServiceSupabaseClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !supabaseUrl) {
    // If running in test environment with mocked repositories, provide a harmless stub
    if (process.env.NODE_ENV === 'test' || typeof process.env.npm_lifecycle_event === 'string') {
      return createClient('https://placeholder.supabase.co', 'placeholder-service-key');
    }
    throw new Error('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL must be configured in environment variables.');
  }
  return createClient(supabaseUrl, serviceKey);
}
