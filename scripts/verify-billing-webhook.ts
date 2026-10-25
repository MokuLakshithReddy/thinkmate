import { createHmac } from 'node:crypto';

const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'mock_webhook_secret';
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const subId = process.argv[2] ?? 'sub_mock_test_123';

async function send(event: string, status: string, createdAt: number, id: string) {
  const body = JSON.stringify({
    event,
    created_at: createdAt,
    payload: {
      subscription: {
        entity: {
          id: subId,
          status,
          plan_id: process.env.RAZORPAY_PLAN_PRO ?? 'plan_pro',
          current_end: createdAt + 30 * 86400,
        },
      },
    },
  });

  const sig = createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': sig,
      'x-razorpay-event-id': id,
    },
    body,
  });
  console.log(event, status, '->', res.status);
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  console.log('Testing billing webhook idempotency, ordering, and signature verification:');
  await send('subscription.activated', 'active', now, 'evt_test_1');
  await send('subscription.activated', 'active', now, 'evt_test_1'); // Duplicate: 200, unchanged
  await send('subscription.halted', 'halted', now - 3600, 'evt_test_0'); // Older timestamp: state preserved
  await send('subscription.cancelled', 'cancelled', now + 60, 'evt_test_2');

  const bad = await fetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'bad_sig' },
    body: '{}',
  });
  console.log('bad signature ->', bad.status, '(expect 400)');
})();
