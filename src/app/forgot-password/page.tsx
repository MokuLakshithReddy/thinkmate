'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setDone(data.message ?? 'If an account exists for that email, a reset link is on its way.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl">
        <h1 className="text-xl font-bold">Reset your password</h1>
        <p className="text-xs text-slate-400">
          Enter your registered email address and we will send you a secure link to reset your password.
        </p>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@domain.com"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="w-full rounded-xl bg-sky-500 hover:bg-sky-400 py-2.5 text-sm font-semibold transition disabled:opacity-50"
        >
          {loading ? 'Sending link...' : 'Send reset link'}
        </button>
        {done && <p className="text-sm text-emerald-400">{done}</p>}
        <div className="pt-2 text-center text-xs text-slate-400">
          <Link href="/login" className="text-sky-400 hover:underline">
            Back to Sign In
          </Link>
        </div>
      </form>
    </main>
  );
}
