'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ResetPassword() {
  const router = useRouter();
  const [token] = useState(() => {
    if (typeof window === 'undefined') return '';
    const hash = window.location.hash.slice(1);
    const h = new URLSearchParams(hash);
    const search = new URLSearchParams(window.location.search);
    const accessToken = h.get('access_token') || search.get('token');
    const type = h.get('type') || search.get('type');
    if ((type === 'recovery' || !type) && accessToken) {
      return accessToken;
    }
    return '';
  });
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(() => {
    if (typeof window === 'undefined') return '';
    const hash = window.location.hash.slice(1);
    const h = new URLSearchParams(hash);
    const search = new URLSearchParams(window.location.search);
    const accessToken = h.get('access_token') || search.get('token');
    const type = h.get('type') || search.get('type');
    if ((type === 'recovery' || !type) && accessToken) {
      return '';
    }
    return 'This reset link is invalid or has expired. Please request a new one.';
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg('');

    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.replace('/login');
      } else {
        setMsg(
          data.error === 'link_expired'
            ? 'This link has expired. Request a new one.'
            : 'Could not reset the password. Password must be at least 8 characters.'
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl">
        <h1 className="text-xl font-bold">Choose a new password</h1>
        <p className="text-xs text-slate-400">
          Enter your new password below (minimum 8 characters).
        </p>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (min 8 chars)"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={!token || loading || password.length < 8}
          className="w-full rounded-xl bg-sky-500 hover:bg-sky-400 py-2.5 text-sm font-semibold transition disabled:opacity-50"
        >
          {loading ? 'Updating password...' : 'Update password'}
        </button>
        {msg && <p className="text-sm text-amber-400">{msg}</p>}
        <div className="pt-2 text-center text-xs text-slate-400">
          <Link href="/login" className="text-sky-400 hover:underline">
            Back to Sign In
          </Link>
        </div>
      </form>
    </main>
  );
}
