'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthModal } from '@/components/modals/AuthModal';
import { refreshSession } from '@/lib/thinkmate/api-client';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('next') ?? '/thinkmate';
  // Only allow same-site relative paths, never external URLs
  const next = raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/thinkmate';

  useEffect(() => {
    refreshSession().then((ok) => {
      if (ok) router.replace(next);
    });
  }, [next, router]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <AuthModal
        isOpen
        onClose={() => router.push('/')}
        onAuthSuccess={async () => {
          try {
            const res = await fetch('/api/auth/consent', { credentials: 'same-origin' });
            if (res.ok) {
              const data = await res.json();
              if (data.has_consent === false) {
                router.replace(`/consent?next=${encodeURIComponent(next)}`);
                router.refresh();
                return;
              }
            }
          } catch (e) {
            console.warn('[login] consent check error', e);
          }
          router.replace(next);
          router.refresh();
        }}
      />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginInner />
    </Suspense>
  );
}

