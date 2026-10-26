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

  let event: {
    event?: string;
    created_at?: number;
    payload?: {
      subscription?: {
        entity?: {
          id?: string;
          status?: string;
          plan_id?: string;
          current_end?: number;
        };
      };
    };
  };

  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const eventId =
    req.headers.get('x-razorpay-event-id') ??
    createHash('sha256').update(raw).digest('hex');
  const admin = adminClient();
  const sub = event.payload?.subscription?.entity;

  if (sub?.id) {
    const eventAt = new Date((event.created_at ?? Math.floor(Date.now() / 1000)) * 1000);
    const { data: row, error: lookupErr } = await admin
      .from('billing_subscriptions')
      .select('user_id, last_event_at')
      .eq('provider_subscription_id', sub.id)
      .maybeSingle();

    if (lookupErr) {
      console.error('[billing] lookup failed for subscription', sub.id, lookupErr);
      return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
    }

    if (!row) {
      console.error('[billing] event for unknown subscription', sub.id);
    }

    if (row && (!row.last_event_at || new Date(row.last_event_at) <= eventAt)) {
      const { error: upErr } = await admin
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

      if (upErr) {
        console.error('[billing] update failed for subscription', sub.id, upErr);
        return NextResponse.json({ error: 'update_failed' }, { status: 500 });
      }
    }
  }

  const { error: eventErr } = await admin.from('billing_events').upsert(
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

  if (eventErr) {
    console.error('[billing] event recording failed', eventId, eventErr);
    return NextResponse.json({ error: 'event_record_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
