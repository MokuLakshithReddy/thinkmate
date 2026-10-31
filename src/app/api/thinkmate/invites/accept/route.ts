import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';

import { checkRateLimitAsync, createRateLimitErrorResponse } from '@/lib/rate-limiter';

const AcceptBody = z.object({
  token: z.string().min(10),
});

export async function POST(req: Request) {
  const a = await authed();
  if (!a) return unauthorized();

  const rl = await checkRateLimitAsync(`invites:accept:${a.user.id}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) return createRateLimitErrorResponse(rl, 'Too many acceptance attempts.');

  const bodyParsed = AcceptBody.safeParse(await req.json().catch(() => null));
  if (!bodyParsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const tokenHash = crypto.createHash('sha256').update(bodyParsed.data.token.trim()).digest('hex');

  const { data, error } = await a.sb.rpc('tm_accept_invite', {
    p_token_hash: tokenHash,
  });

  if (error) {
    console.error('[Invite Accept Error]:', error);
    return NextResponse.json({ error: 'accept_failed', message: 'Failed to process invitation.' }, { status: 400 });
  }

  if (!data?.ok) {
    return NextResponse.json(
      { error: 'invalid_or_expired', message: 'Invitation is invalid or has expired.' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    workspace_id: data.workspace_id,
    role: data.role,
  });
}
