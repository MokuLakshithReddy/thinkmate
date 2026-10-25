import { NextResponse } from 'next/server';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';

export async function POST(req: Request) {
  const a = await authed();
  if (!a) return unauthorized();

  const { title } = await req.json().catch(() => ({}));
  const { data, error } = await a.sb
    .from('tm_workspaces')
    .insert({
      owner_id: a.user.id,
      title: String(title ?? 'Untitled problem').slice(0, 120),
    })
    .select('id')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }

  await logEvent(a.sb, data.id, 'workspace_created');
  return NextResponse.json(data);
}
