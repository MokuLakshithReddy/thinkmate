import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/thinkmate/flags';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';
import { research } from '@/lib/thinkmate/research';

export const maxDuration = 60;

const Body = z.object({ question: z.string().trim().min(5).max(300) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!flags.research) {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }

  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { data: ws } = await a.sb
    .from('tm_workspaces')
    .select('problem_frame')
    .eq('id', id)
    .maybeSingle();

  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: usage } = await a.sb.rpc('tm_my_usage');
  if (usage && (usage?.research_used ?? 0) >= (usage?.research_limit ?? 3)) {
    return NextResponse.json({ error: 'plan_limit', upgrade: true }, { status: 429 });
  }

  const r = await research(b.data.question, ws.problem_frame ?? 'not framed yet').catch(() => null);
  if (!r || !r.text || r.sources.length === 0) {
    return NextResponse.json({ error: 'no_sources' }, { status: 422 });
  }

  const { data } = await a.sb
    .from('tm_evidence')
    .insert({
      workspace_id: id,
      kind: 'web_source',
      added_by: 'research',
      title: b.data.question.slice(0, 120),
      source_ref: r.sources[0]?.uri ?? null,
      summary: r.text.slice(0, 4000),
      limitations: [
        'Model summary of web results. Open the sources and check them before relying on it.',
      ],
      meta: { sources: r.sources },
    })
    .select()
    .single();

  await logEvent(a.sb, id, 'research', { sources: r.sources.length });
  return NextResponse.json(data);
}
