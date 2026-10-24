import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';

const Body = z.object({
  selected_item_id: z.string().uuid(),
  rationale: z.string().trim().min(10).max(1000),
  rejected_item_ids: z.array(z.string().uuid()).max(10).default([]),
  reconsider_if: z.string().trim().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const ids = [b.data.selected_item_id, ...b.data.rejected_item_ids];
  const { data: items } = await a.sb
    .from('tm_items')
    .select('id, kind, status')
    .eq('workspace_id', id)
    .in('id', ids);

  const sel = (items ?? []).find((i: any) => i.id === b.data.selected_item_id);
  if (
    !sel ||
    sel.kind !== 'idea' ||
    sel.status !== 'confirmed' ||
    (items ?? []).length !== new Set(ids).size
  ) {
    return NextResponse.json({ error: 'invalid_selection' }, { status: 400 });
  }

  const { data, error } = await a.sb
    .from('tm_decisions')
    .insert({ workspace_id: id, ...b.data })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  await logEvent(a.sb, id, 'decision_recorded', { rejected: b.data.rejected_item_ids.length });
  return NextResponse.json(data);
}
