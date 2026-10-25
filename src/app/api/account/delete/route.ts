import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { supabase } from '@/services/db/supabase-client';
import { adminClient } from '@/lib/supabase-admin';
import { clearAuthCookies } from '@/lib/server-auth';
import { razorpay } from '@/lib/billing/razorpay';

const Body = z.object({
  confirm: z.literal('DELETE'),
  password: z.string().min(1).max(100),
});

export async function POST(req: Request) {
  const a = await authed();
  if (!a || !a.user.email) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { error: pwErr } = await supabase.auth.signInWithPassword({
    email: a.user.email,
    password: b.data.password,
  });
  if (pwErr) return NextResponse.json({ error: 'wrong_password' }, { status: 403 });

  const admin = adminClient();

  // If user has an active billing subscription, cancel immediately so they aren't billed after deletion
  try {
    const { data: subRow } = await admin
      .from('billing_subscriptions')
      .select('provider_subscription_id, status')
      .eq('user_id', a.user.id)
      .maybeSingle();

    if (subRow?.provider_subscription_id && subRow.status === 'active') {
      try {
        await razorpay().subscriptions.cancel(subRow.provider_subscription_id, false);
      } catch (cancelErr) {
        console.error('[Account Delete] Failed to cancel subscription:', cancelErr);
        return NextResponse.json({ error: 'subscription_cancel_failed' }, { status: 502 });
      }
    }
  } catch {
    // Proceed if billing tables or credentials not present
  }

  const { error } = await admin.auth.admin.deleteUser(a.user.id);
  if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 });

  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
