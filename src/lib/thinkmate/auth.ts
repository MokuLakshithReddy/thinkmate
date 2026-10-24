import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export async function createClient(): Promise<SupabaseClient> {
  const store = await cookies();
  const token =
    store.get('thinkmate_auth_token')?.value ||
    store.get('sb-access-token')?.value ||
    store.get('sb-ffjgbefnubyjzrlvpdkl-auth-token')?.value;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Can fail if called in Server Component without response context
        }
      },
    },
    global: token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : undefined,
  });
}

export async function authed(): Promise<{ sb: SupabaseClient; user: User } | null> {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    return user ? { sb, user } : null;
  } catch {
    return null;
  }
}

export const unauthorized = () =>
  NextResponse.json({ error: 'unauthorized' }, { status: 401 });
