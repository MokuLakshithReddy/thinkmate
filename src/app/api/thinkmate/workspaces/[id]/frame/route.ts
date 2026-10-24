import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';

const Body = z.object({
  action: z.enum(['confirm', 'reject', 'edit']),
  text: z.string().trim().min(10).max(500).optional(),
  expected_updated_at: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { data: ws } = await a.sb
    .from('tm_workspaces')
    .select('id, proposed_problem_frame, problem_frame, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Concurrency check (Layer 6)
  if (b.data.expected_updated_at && ws.updated_at !== b.data.expected_updated_at) {
    return NextResponse.json({ error: 'conflict', current: ws }, { status: 409 });
  }

  const { action, text } = b.data;
  const frame = action === 'edit' ? text : ws.proposed_problem_frame;
  if (action !== 'reject' && !frame) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // Frame versioning (Layer 1)
  if (action !== 'reject') {
    const { data: last } = await a.sb
      .from('tm_frames')
      .select('id, version, statement')
      .eq('workspace_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    const same = last && last.statement.trim().toLowerCase() === String(frame).trim().toLowerCase();
    if (!same) {
      await a.sb.from('tm_frames').insert({
        workspace_id: id,
        version: (last?.version ?? 0) + 1,
        statement: String(frame),
        supersedes_id: last?.id ?? null,
      });
    }
  }

  const patch =
    action === 'reject'
      ? { proposed_problem_frame: null }
      : {
          problem_frame: frame,
          problem_frame_confirmed: true,
          proposed_problem_frame: null,
        };

  const { data } = await a.sb
    .from('tm_workspaces')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  await logEvent(a.sb, id, action === 'reject' ? 'frame_rejected' : 'frame_confirmed');
  return NextResponse.json(data);
}
