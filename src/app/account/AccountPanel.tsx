'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/thinkmate/api-client';

const J = { 'Content-Type': 'application/json' };

type Usage = {
  plan: string;
  turns_used: number;
  turns_limit: number;
  workspaces_used: number;
  workspaces_limit: number;
};

export function AccountPanel({ email }: { email: string }) {
  const router = useRouter();
  const [u, setU] = useState<Usage | null>(null);
  const [msg, setMsg] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiFetch('/api/account/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then(setU)
      .catch(() => undefined);
  }, []);

  async function cancel() {
    setCanceling(true);
    setMsg('');
    try {
      const r = await apiFetch('/api/billing/cancel', { method: 'POST' });
      setMsg(
        r.ok
          ? 'Cancelled. You keep your plan until the end of the paid period.'
          : 'Could not cancel. Please try again or contact support.'
      );
    } catch {
      setMsg('Network error cancelling subscription.');
    } finally {
      setCanceling(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setMsg('');
    try {
      const r = await apiFetch('/api/account/delete', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ confirm: confirmText, password }),
      });
      if (r.ok) {
        router.push('/');
      } else {
        setMsg(
          r.status === 403
            ? 'Wrong password.'
            : 'Could not delete the account. Nothing was deleted.'
        );
      }
    } catch {
      setMsg('Network error deleting account.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6 text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold">Account</h1>
          <p className="text-sm text-slate-400 mt-1">{email}</p>
        </div>
        <Link href="/thinkmate" className="text-xs text-sky-400 hover:underline">
          &larr; Back to Workspaces
        </Link>
      </div>

      {u && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 text-sm space-y-2">
          <p className="capitalize">
            Plan: <b className="text-white">{u.plan}</b>
          </p>
          <p className="text-slate-300">
            Turns today: {u.turns_used} / {u.turns_limit}
          </p>
          <p className="text-slate-300">
            Workspaces: {u.workspaces_used} / {u.workspaces_limit}
          </p>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center gap-4 text-xs">
            <Link href="/pricing" className="text-sky-400 underline hover:text-sky-300 font-medium">
              Change plan
            </Link>
            {u.plan !== 'free' && (
              <button
                onClick={cancel}
                disabled={canceling}
                className="text-amber-400 underline hover:text-amber-300 disabled:opacity-50"
              >
                {canceling ? 'Cancelling...' : 'Cancel subscription'}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-rose-900/60 bg-rose-950/10 p-5 text-sm">
        <h2 className="font-semibold text-rose-300">Delete my account</h2>
        <p className="mt-1 text-xs text-slate-400">
          Permanently deletes your workspaces, sessions, and active subscription. This action is immediate and cannot be undone.
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type DELETE"
          className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
        />
        <button
          onClick={remove}
          disabled={confirmText !== 'DELETE' || !password || deleting}
          className="mt-4 rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
        >
          {deleting ? 'Deleting account...' : 'Delete forever'}
        </button>
      </section>

      {msg && <p className="text-sm text-amber-400">{msg}</p>}
    </main>
  );
}
