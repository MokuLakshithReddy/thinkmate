import { NextResponse } from 'next/server';
import { authed, unauthorized } from '@/lib/thinkmate/auth';

export async function GET() {
  const a = await authed();
  if (!a) return unauthorized();

  const { data, error } = await a.sb.rpc('tm_my_usage');
  if (error) {
    return NextResponse.json({ error: 'usage_unavailable' }, { status: 503 });
  }

  return NextResponse.json(data);
}
