import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';
import { STAGES, canMove, type Stage } from '@/lib/thinkmate/stages';

const Body = z.object({ stage: z.enum(STAGES) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { data: ws } = await a.sb
    .from('tm_workspaces')
    .select('stage')
    .eq('id', id)
    .maybeSingle();

  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!canMove(ws.stage as Stage, b.data.stage)) {
    return NextResponse.json({ error: 'invalid_transition' }, { status: 409 });
  }

  const { data } = await a.sb
    .from('tm_workspaces')
    .update({ stage: b.data.stage, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  await logEvent(a.sb, id, 'stage_changed', { from: ws.stage, to: b.data.stage });
  return NextResponse.json(data);
}
