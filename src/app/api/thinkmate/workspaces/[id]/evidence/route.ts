import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';

const Body = z.object({
  kind: z.enum(['observation', 'interview', 'document', 'dataset', 'experiment', 'web_source']),
  title: z.string().trim().min(3).max(200),
  source_ref: z.string().trim().max(500).optional(),
  summary: z.string().trim().min(3).max(4000),
  limitations: z.array(z.string().max(300)).max(5).default([]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { data, error } = await a.sb
    .from('tm_evidence')
    .insert({ ...b.data, workspace_id: id })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'create_failed' }, { status: 400 });
  }

  await logEvent(a.sb, id, 'evidence_added', { kind: b.data.kind });
  return NextResponse.json(data);
}
