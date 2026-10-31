import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { checkRateLimitAsync, createRateLimitErrorResponse } from '@/lib/rate-limiter';

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
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }

  return NextResponse.json({ invites: invites ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const rl = await checkRateLimitAsync(`invites:create:${a.user.id}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) return createRateLimitErrorResponse(rl, 'Too many invitation requests.');

  const bodyParsed = InviteBody.safeParse(await req.json().catch(() => null));
  if (!bodyParsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // Generate token & hash
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { error: rpcError } = await a.sb.rpc('tm_create_invite', {
    p_workspace_id: id,
    p_email: bodyParsed.data.email.toLowerCase(),
    p_role: bodyParsed.data.role,
    p_token_hash: tokenHash,
  });

  if (rpcError) {
    if (rpcError.message.includes('not_owner')) {
      return NextResponse.json(
        { error: 'not_owner', message: 'Only workspace owners can invite members.' },
        { status: 403 }
      );
    }
    if (rpcError.message.includes('plan_required')) {
      return NextResponse.json(
        { error: 'team_plan_required', message: 'An active Team plan is required to invite collaborators.' },
        { status: 403 }
      );
    }
    if (rpcError.message.includes('too_many_pending')) {
      return NextResponse.json(
        { error: 'too_many_pending', message: 'Limit of 20 pending invitations reached.' },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: 'invite_failed', message: 'Failed to create workspace invitation.' },
      { status: 500 }
    );
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
