import Razorpay from 'razorpay';

export function razorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw new Error('billing_not_configured');
  return new Razorpay({ key_id, key_secret });
}

export const PLAN_IDS: Record<'pro' | 'team', string | undefined> = {
  pro: process.env.RAZORPAY_PLAN_PRO,
  team: process.env.RAZORPAY_PLAN_TEAM,
};

export function planFromRazorpayPlanId(id?: string): 'pro' | 'team' | null {
  if (!id) return null;
  if (id === process.env.RAZORPAY_PLAN_PRO) return 'pro';
  if (id === process.env.RAZORPAY_PLAN_TEAM) return 'team';
  return null;
}
