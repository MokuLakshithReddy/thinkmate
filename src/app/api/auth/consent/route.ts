import { NextResponse } from 'next/server';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { checkConsent, recordConsent } from '@/lib/legal';

export async function GET() {
  const a = await authed();
  if (!a) return unauthorized();

  const hasConsent = await checkConsent(a.user.id);
  return NextResponse.json({ has_consent: hasConsent });
}

export async function POST() {
  const a = await authed();
  if (!a) return unauthorized();

  await recordConsent(a.user.id);
  return NextResponse.json({ ok: true });
}
