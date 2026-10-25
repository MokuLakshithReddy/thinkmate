'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { apiFetch } from '@/lib/thinkmate/api-client';

type Usage = { plan: string; turns_used: number; turns_limit: number };

export function UsageMeter({ refreshKey }: { refreshKey: number }) {
  const [u, setU] = useState<Usage | null>(null);

  useEffect(() => {
    apiFetch('/api/account/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then(setU)
      .catch(() => setU(null));
  }, [refreshKey]);

  if (!u) return null;

  const pct = Math.min(100, Math.round((u.turns_used / Math.max(u.turns_limit, 1)) * 100));

  return (
    <div className="text-[11px] text-slate-400">
      <div className="flex justify-between gap-3">
        <span className="capitalize font-medium text-slate-300">{u.plan} plan</span>
        <span>
          {u.turns_used}/{u.turns_limit} turns today
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-800 w-36">
        <motion.div
          className={pct > 85 ? 'h-full bg-amber-400' : 'h-full bg-sky-400'}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      {pct >= 80 && (
        <a href="/pricing" className="mt-1 inline-block text-sky-400 underline hover:text-sky-300">
          Upgrade for more turns
        </a>
      )}
    </div>
  );
}
