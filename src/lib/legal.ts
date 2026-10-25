import { adminClient } from '@/lib/supabase-admin';

export const LEGAL_VERSION = { terms: '2026-11-01', privacy: '2026-11-01' } as const;

export async function recordConsent(userId: string) {
  const rows = Object.entries(LEGAL_VERSION).map(([document, version]) => ({
    user_id: userId,
    document,
    version,
  }));

  try {
    const { error } = await adminClient()
      .from('user_consents')
      .upsert(rows, { onConflict: 'user_id,document,version', ignoreDuplicates: true });

    if (error) {
      console.error('[Legal] Failed to record user consent:', error);
    }
  } catch (err) {
    console.warn('[Legal] Consent recording skipped or admin client not configured:', err);
  }
}
