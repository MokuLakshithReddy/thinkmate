'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthModal } from '@/components/modals/AuthModal';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('next') ?? '/thinkmate';
  // Only allow same-site relative paths, never external URLs
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/thinkmate';

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <AuthModal
        isOpen
        onClose={() => router.push('/')}
        onAuthSuccess={() => {
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
