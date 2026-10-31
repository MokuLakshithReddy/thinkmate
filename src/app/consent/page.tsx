'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, ArrowRight, Loader2 } from 'lucide-react';

function ConsentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('next') ?? '/thinkmate';
  const next = raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/thinkmate';

  const [termsAgreed, setTermsAgreed] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termsAgreed || !privacyAgreed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/consent', {
        method: 'POST',
        credentials: 'same-origin',
      });

      if (!res.ok) {
        throw new Error('Failed to record consent. Please try again.');
      }

      router.replace(next);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred while saving your consent.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-500 via-sky-400 to-emerald-400 p-[2px]">
            <div className="h-full w-full bg-slate-950 rounded-[10px] flex items-center justify-center font-bold text-sky-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Terms & Privacy Updates</h1>
            <p className="text-xs text-slate-400">Action required to access your account</p>
          </div>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed mb-6">
          To continue using ThinkMate, please review and accept our updated Terms of Service and Privacy Policy.
        </p>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer transition">
            <input
              type="checkbox"
              checked={termsAgreed}
              onChange={(e) => setTermsAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-700 text-sky-500 focus:ring-sky-400 bg-slate-900"
            />
            <span className="text-xs text-slate-300">
              I have read and agree to the{' '}
              <Link
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 hover:underline font-medium"
              >
                Terms of Service
              </Link>{' '}
              (Version 2026-11-01).
            </span>
          </label>

          <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer transition">
            <input
              type="checkbox"
              checked={privacyAgreed}
              onChange={(e) => setPrivacyAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-700 text-sky-500 focus:ring-sky-400 bg-slate-900"
            />
            <span className="text-xs text-slate-300">
              I have read and accept the{' '}
              <Link
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 hover:underline font-medium"
              >
                Privacy Policy
              </Link>{' '}
              detailing data processing and security commitments.
            </span>
          </label>

          <button
            type="submit"
            disabled={!termsAgreed || !privacyAgreed || loading}
            className="w-full mt-6 py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed shadow-lg shadow-sky-500/10"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Recording consent...
              </>
            ) : (
              <>
                Agree and Continue
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <ConsentInner />
    </Suspense>
  );
}
