'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/thinkmate/api-client';

export function UpgradeButton({ plan, label }: { plan: 'pro' | 'team'; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go() {
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.assign(data.url);
      } else {
        setErr(
          data.error === 'already_subscribed'
            ? 'You already have an active plan.'
            : 'Could not start checkout. Please try again.'
        );
      }
    } catch {
      setErr('Connection error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 py-2.5 text-sm font-semibold text-white transition shadow-lg shadow-sky-500/20 disabled:opacity-50"
      >
        {busy ? 'Opening checkout...' : label}
      </button>
      {err && <p className="mt-2 text-xs text-amber-400">{err}</p>}
    </div>
  );
}
