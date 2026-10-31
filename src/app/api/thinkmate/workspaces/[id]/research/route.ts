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

  const { data: resData, error: resErr } = await a.sb.rpc('tm_reserve_research_quota', {
    p_workspace_id: id,
  });

  if (!resErr && resData) {
    if (resData.allowed === true) {
      // Affirmative quota approval granted
    } else if (resData.allowed === false) {
      return NextResponse.json({ error: 'plan_limit', upgrade: true }, { status: 429 });
    } else {
      console.error('[Research Quota Malformed Response]:', resData);
      return NextResponse.json({ error: 'quota_service_unavailable' }, { status: 503 });
    }
  } else if (resErr && (resErr.code === 'PGRST202' || resErr.message?.includes('Could not find'))) {
    // Non-production fallback
    const { data: usage, error: usageErr } = await a.sb.rpc('tm_my_usage');
    if (usageErr || !usage || typeof usage.research_limit !== 'number') {
      console.error('[Research Quota Fallback Error]:', usageErr);
      return NextResponse.json({ error: 'quota_service_unavailable' }, { status: 503 });
    }
    if ((usage.research_used ?? 0) >= usage.research_limit) {
      return NextResponse.json({ error: 'plan_limit', upgrade: true }, { status: 429 });
    }
  } else {
    console.error('[Research Quota RPC Error]:', resErr);
    return NextResponse.json({ error: 'quota_service_unavailable' }, { status: 503 });
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
