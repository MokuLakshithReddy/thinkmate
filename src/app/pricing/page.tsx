import Link from 'next/link';
import { PLANS } from '@/lib/billing/plans';
import { UpgradeButton } from './UpgradeButton';

export const metadata = {
  title: 'Pricing — ThinkMate',
  description: 'Free to start. Upgrade when you want more guided turns and research.',
};

export default function Pricing() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <div className="max-w-5xl mx-auto">
        <div className="text-center space-y-3">
          <Link href="/" className="text-xs text-sky-400 hover:underline">
            &larr; Back to ThinkMate
          </Link>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Think better, not just faster</h1>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Choose the plan that fits your thinking pace. All plans include full problem framing, evidence tracking, and export capabilities.
          </p>
        </div>

        <div className="mt-12 grid max-w-5xl gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <section
              key={p.id}
              className={`rounded-2xl border p-6 flex flex-col justify-between transition ${
                p.id === 'pro'
                  ? 'border-sky-500/50 bg-slate-900/80 shadow-xl shadow-sky-500/10'
                  : 'border-slate-800 bg-slate-900/40'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">{p.name}</h2>
                  {p.id === 'pro' && (
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30">
                      Popular
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-400">{p.blurb}</p>
                <p className="mt-4 text-3xl font-extrabold">
                  {p.priceInr === 0 ? 'Free' : `₹${p.priceInr}`}
                  <span className="text-sm font-normal text-slate-400">{p.priceInr ? ' / month' : ''}</span>
                </p>
                <ul className="mt-6 space-y-2 text-sm text-slate-300">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <span className="text-sky-400 text-xs">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8">
                {p.id === 'free' ? (
                  <Link
                    href="/login?next=/thinkmate"
                    className="block rounded-xl border border-slate-700 hover:border-slate-500 py-2.5 text-center text-sm font-semibold transition"
                  >
                    Start free
                  </Link>
                ) : (
                  <UpgradeButton plan={p.id} label={`Choose ${p.name}`} />
                )}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-12 text-center text-xs text-slate-500">
          Prices in INR, billed monthly through Razorpay. Cancel any time; access continues to the end of the paid period. See our{' '}
          <Link className="underline hover:text-slate-400" href="/terms">
            Terms
          </Link>{' '}
          and{' '}
          <Link className="underline hover:text-slate-400" href="/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
