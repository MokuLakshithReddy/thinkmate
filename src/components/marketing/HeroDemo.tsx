'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const CLAIM = 'Students miss workshops because they hear about them too late';

export function HeroDemo() {
  const [step, setStep] = useState(0); // 0 empty, 1 proposed, 2 confirmed, 3 empty

  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 4), 2200);
    return () => clearInterval(t);
  }, []);

  const card = (
    <motion.div
      layoutId="demo-card"
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className="rounded-xl border border-sky-500/40 bg-slate-900 p-3 text-sm shadow-lg shadow-sky-500/10 text-slate-100"
    >
      <span className="mr-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-900 font-semibold">
        your words
      </span>
      {CLAIM}
    </motion.div>
  );

  return (
    <div
      className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-5 shadow-2xl"
      aria-hidden
    >
      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wider text-amber-300 font-bold">
          Waiting for your decision
        </p>
        <div className="min-h-[84px] flex items-center">{step === 1 && card}</div>
      </div>
      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wider text-emerald-300 font-bold">
          Confirmed
        </p>
        <div className="min-h-[84px] flex items-center">{step === 2 && card}</div>
      </div>
    </div>
  );
}
