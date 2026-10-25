'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/thinkmate/api-client';

export default function InviteAcceptPage() {
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : '';
  const router = useRouter();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/account/usage')
      .then((res) => {
        setIsAuthenticated(res.ok);
      })
      .catch(() => {
        setIsAuthenticated(false);
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, []);

  async function handleAccept() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/thinkmate/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error || 'Failed to accept invitation');
        return;
      }

      router.push(`/thinkmate/${body.workspace_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mb-3 font-bold text-xl">
            TM
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Workspace Invitation</h1>
          <p className="text-sm text-slate-400 mt-1">
            You have been invited to collaborate on a ThinkMate workspace.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 text-sm rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
            {error}
          </div>
        )}

        {checkingAuth ? (
          <div className="py-8 text-center text-sm text-slate-500">Checking credentials...</div>
        ) : isAuthenticated ? (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300">
              Authenticated and ready to join workspace.
            </div>
            <button
              onClick={handleAccept}
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm transition-colors shadow-lg shadow-indigo-600/20"
            >
              {submitting ? 'Joining workspace...' : 'Accept Invitation & Join'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed text-center">
              Please sign in or create an account to accept this invitation and access the shared workspace.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="block w-full text-center py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-colors shadow-lg shadow-indigo-600/20"
            >
              Sign In to Accept
            </Link>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-300 transition-colors">
            Back to ThinkMate Home
          </Link>
        </div>
      </div>
    </div>
  );
}
