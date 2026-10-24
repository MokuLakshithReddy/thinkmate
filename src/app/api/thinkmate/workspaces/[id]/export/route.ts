import { NextResponse } from 'next/server';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { loadState } from '@/lib/thinkmate/state';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const s: any = await loadState(a.sb, id);
  if (!s) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const section = (st: string) => [
    `## ${st.toUpperCase()}`,
    ...s.items
      .filter((i: any) => i.status === st)
      .map((i: any) => `- [${i.kind} | origin: ${i.origin} | ${i.verification}] ${i.text}`),
    '',
  ];

  const lines = [
    `# ${s.ws.title}`,
    '',
    `**Stage:** ${s.ws.stage} | **Mode:** ${s.ws.mode}`,
    `**Problem frame (${s.ws.problem_frame_confirmed ? 'confirmed' : 'not confirmed'}):** ${
      s.ws.problem_frame ?? 'none'
    }`,
    '',
    '## Frame history',
    ...(s.frames.length
      ? s.frames.map((f: any) => `- v${f.version}: ${f.statement}`)
      : ['- None yet']),
    '',
    ...section('confirmed'),
    ...section('rejected'),
    ...section('proposed'),
    '## Evidence',
    ...(s.evidence?.length
      ? s.evidence.map(
          (e: any) =>
            `- (${e.kind}) **${e.title}**: ${e.summary}${
              e.source_ref ? ' [' + e.source_ref + ']' : ''
            }`
        )
      : ['- No evidence recorded']),
    '',
    '## Decisions',
    ...(s.decisions?.length
      ? s.decisions.map(
          (d: any) =>
            `- **Rationale:** ${d.rationale}${
              d.reconsider_if ? ' *(reconsider if: ' + d.reconsider_if + ')*' : ''
            }`
        )
      : ['- No decisions finalized']),
  ];

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename=thinkmate-${id}.md`,
    },
  });
}
