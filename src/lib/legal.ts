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

export async function checkConsent(userId: string): Promise<boolean> {
  try {
    const { data, error } = await adminClient()
      .from('user_consents')
      .select('document, version')
      .eq('user_id', userId);

    if (error || !data) return false;

    const hasTerms = data.some(
      (r) => r.document === 'terms' && r.version === LEGAL_VERSION.terms
    );
    const hasPrivacy = data.some(
      (r) => r.document === 'privacy' && r.version === LEGAL_VERSION.privacy
    );

    return hasTerms && hasPrivacy;
  } catch {
    return false;
  }
}

