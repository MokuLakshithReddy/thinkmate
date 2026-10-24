import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/thinkmate/flags';
import { authed, unauthorized } from '@/lib/thinkmate/auth';

const InviteBody = z.object({
  invitee_email: z.string().email(),
  member_role: z.enum(['editor', 'viewer']).default('editor'),
});

const RemoveBody = z.object({
  user_id: z.string().uuid(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!flags.teams) return NextResponse.json({ error: 'disabled' }, { status: 404 });

  const a = await authed();
  if (!a) return unauthorized();

  const b = InviteBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { error } = await a.sb.rpc('tm_invite', {
    ws: id,
    invitee_email: b.data.invitee_email,
    member_role: b.data.member_role,
  });

  if (error) {
    if (error.message.includes('not_owner')) {
      return NextResponse.json({ error: 'not_owner' }, { status: 403 });
    }
    if (error.message.includes('no_such_user')) {
      return NextResponse.json({ error: 'no_such_user' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!flags.teams) return NextResponse.json({ error: 'disabled' }, { status: 404 });

  const a = await authed();
  if (!a) return unauthorized();

  const b = RemoveBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { error } = await a.sb
    .from('tm_members')
    .delete()
    .eq('workspace_id', id)
    .eq('user_id', b.data.user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
