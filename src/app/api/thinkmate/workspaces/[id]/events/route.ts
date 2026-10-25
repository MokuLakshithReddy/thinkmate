import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { Mode } from '@/lib/thinkmate/schemas';
import { logEvent } from '@/lib/thinkmate/state';

const Ev = z.object({
  type: z.enum(['session_start', 'mode_changed', 'abandon', 'session_end']),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const b = Ev.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  if (b.data.type === 'mode_changed') {
    const m = Mode.safeParse(b.data.payload?.mode);
    if (!m.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    await a.sb.from('tm_workspaces').update({ mode: m.data }).eq('id', id);
  }

  await logEvent(a.sb, id, b.data.type, (b.data.payload ?? {}) as Record<string, unknown>);
  return NextResponse.json({ ok: true });
}
