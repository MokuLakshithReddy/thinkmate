import { NextResponse } from 'next/server';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { loadState } from '@/lib/thinkmate/state';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();
  const s = await loadState(a.sb, id);
  return s ? NextResponse.json(s) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();
  const { data, error } = await a.sb.from('tm_workspaces').delete().eq('id', id).select('id');
  if (error) {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
  return data?.length ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
