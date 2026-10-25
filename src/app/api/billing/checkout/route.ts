import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { adminClient } from '@/lib/supabase-admin';
import { razorpay, PLAN_IDS } from '@/lib/billing/razorpay';

const Body = z.object({ plan: z.enum(['pro', 'team']) });

export async function POST(req: Request) {
  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const planId = PLAN_IDS[b.data.plan];
  if (!planId) return NextResponse.json({ error: 'plan_unavailable' }, { status: 503 });

  const admin = adminClient();
  const { data: existing } = await admin
    .from('billing_subscriptions')
    .select('status')
    .eq('user_id', a.user.id)
    .maybeSingle();

  if (existing && ['active', 'authenticated'].includes(existing.status)) {
    return NextResponse.json({ error: 'already_subscribed' }, { status: 409 });
  }

  try {
    const sub = await razorpay().subscriptions.create({
      plan_id: planId,
      total_count: 120,
      customer_notify: 1,
      notes: { user_id: a.user.id, plan: b.data.plan },
    });

    await admin.from('billing_subscriptions').upsert(
      {
        user_id: a.user.id,
        provider: 'razorpay',
        provider_subscription_id: sub.id,
        plan: b.data.plan,
        status: (sub.status as string) ?? 'created',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    const shortUrl = (sub as { short_url?: string }).short_url;
    return NextResponse.json({ url: shortUrl });
  } catch (err) {
    console.error('[Billing Checkout Error]:', err);
    return NextResponse.json({ error: 'checkout_failed' }, { status: 502 });
  }
}
