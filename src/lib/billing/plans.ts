export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    priceInr: 0,
    blurb: 'Try guided thinking',
    features: ['30 guided turns a day', '3 workspaces', '3 research searches a day'],
  },
  {
    id: 'pro',
    name: 'Pro',
    priceInr: Number(process.env.NEXT_PUBLIC_PRICE_PRO_INR ?? 499),
    blurb: 'For serious hackathon prep',
    features: [
      '300 guided turns a day',
      '100 workspaces',
      '30 research searches a day',
      'Export and evidence tracking',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    priceInr: Number(process.env.NEXT_PUBLIC_PRICE_TEAM_INR ?? 1499),
    blurb: 'For your whole team',
    features: [
      '1000 guided turns a day',
      '500 workspaces',
      '100 research searches a day',
      'Shared workspaces',
    ],
  },
] as const;

export type PlanId = (typeof PLANS)[number]['id'];
