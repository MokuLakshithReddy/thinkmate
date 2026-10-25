import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import Razorpay from 'razorpay';
import { adminClient } from '@/lib/supabase-admin';
import { planFromRazorpayPlanId } from '@/lib/billing/razorpay';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  let valid = false;

  try {
    valid = Boolean(secret && signature && Razorpay.validateWebhookSignature(raw, signature, secret));
  } catch {
    valid = false;
  }

  if (!valid) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  const event = JSON.parse(raw);
  const eventId =
    req.headers.get('x-razorpay-event-id') ??
    createHash('sha256').update(raw).digest('hex');
  const admin = adminClient();
  const sub = event.payload?.subscription?.entity;

  if (sub?.id) {
    const eventAt = new Date((event.created_at ?? Math.floor(Date.now() / 1000)) * 1000);
    const { data: row } = await admin
      .from('billing_subscriptions')
      .select('user_id, last_event_at')
      .eq('provider_subscription_id', sub.id)
      .maybeSingle();

    if (row && (!row.last_event_at || new Date(row.last_event_at) <= eventAt)) {
      await admin
        .from('billing_subscriptions')
        .update({
          status: sub.status,
          plan: planFromRazorpayPlanId(sub.plan_id) ?? undefined,
          current_period_end: sub.current_end
            ? new Date(sub.current_end * 1000).toISOString()
            : null,
          last_event_at: eventAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('provider_subscription_id', sub.id);
    }
  }

  await admin.from('billing_events').upsert(
    {
      id: eventId,
      event_type: String(event.event),
      payload: {
        event: event.event,
        subscription_id: sub?.id ?? null,
        status: sub?.status ?? null,
      },
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );

  return NextResponse.json({ ok: true });
}
