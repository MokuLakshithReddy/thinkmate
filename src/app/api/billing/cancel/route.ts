import { NextResponse } from 'next/server';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { adminClient } from '@/lib/supabase-admin';
import { razorpay } from '@/lib/billing/razorpay';

export async function POST() {
  const a = await authed();
  if (!a) return unauthorized();

  const { data: row } = await adminClient()
    .from('billing_subscriptions')
    .select('provider_subscription_id, status')
    .eq('user_id', a.user.id)
    .maybeSingle();

  if (!row?.provider_subscription_id || row.status !== 'active') {
    return NextResponse.json({ error: 'no_active_subscription' }, { status: 404 });
  }

  try {
    await razorpay().subscriptions.cancel(row.provider_subscription_id, true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Billing Cancel Error]:', err);
    return NextResponse.json({ error: 'cancel_failed' }, { status: 502 });
  }
}
