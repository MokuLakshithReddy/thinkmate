import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';

const InviteBody = z.object({
  email: z.string().email(),
  role: z.enum(['editor', 'viewer']).default('editor'),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const { data: invites, error } = await a.sb
    .from('tm_invites')
    .select('id, email, role, created_at, expires_at, accepted_at')
    .eq('workspace_id', id)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ invites: invites ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const bodyParsed = InviteBody.safeParse(await req.json().catch(() => null));
  if (!bodyParsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // 1. Verify workspace ownership
  const { data: ws, error: wsError } = await a.sb
    .from('tm_workspaces')
    .select('id, owner_id, title')
    .eq('id', id)
    .single();

  if (wsError || !ws) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  if (ws.owner_id !== a.user.id) {
    return NextResponse.json({ error: 'Only the workspace owner can invite members' }, { status: 403 });
  }

  // 2. Verify workspace owner has Team plan
  const { data: sub } = await a.sb
    .from('billing_subscriptions')
    .select('plan, status, current_period_end')
    .eq('user_id', a.user.id)
    .maybeSingle();

  const now = new Date();
  const isTeam =
    sub?.plan === 'team' &&
    (['active', 'authenticated'].includes(sub.status) ||
      (sub.status === 'cancelled' && sub.current_period_end && new Date(sub.current_period_end) > now));

  if (!isTeam) {
    return NextResponse.json(
      {
        error: 'team_plan_required',
        message: 'Shared team workspaces and collaborator invitations require an active Team plan.',
      },
      { status: 403 }
    );
  }

  // 3. Generate token & hash
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { error: insertError } = await a.sb.from('tm_invites').insert({
    workspace_id: id,
    email: bodyParsed.data.email.toLowerCase(),
    role: bodyParsed.data.role,
    token_hash: tokenHash,
    invited_by: a.user.id,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  const origin =
    req.headers.get('origin') ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://thinkmate.vercel.app';
  const inviteUrl = `${origin}/invite/${rawToken}`;

  return NextResponse.json({
    ok: true,
    invite_url: inviteUrl,
    token: rawToken,
    email: bodyParsed.data.email.toLowerCase(),
    role: bodyParsed.data.role,
  });
}
