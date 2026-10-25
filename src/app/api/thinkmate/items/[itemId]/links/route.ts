import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';
import { verificationOf } from '@/lib/thinkmate/evidence';

import type { SupabaseClient } from '@supabase/supabase-js';

const Body = z.object({
  evidence_id: z.string().uuid(),
  relation: z.enum(['supports', 'contradicts', 'context']).optional(),
});

type Ctx = { params: Promise<{ itemId: string }> };

async function recompute(sb: SupabaseClient, itemId: string) {
  const { data } = await sb.from('tm_item_evidence').select('relation').eq('item_id', itemId);
  const rows = (data ?? []) as { relation: string }[];
  const v = verificationOf(rows.map((r) => r.relation));
  await sb
    .from('tm_items')
    .update({ verification: v, updated_at: new Date().toISOString() })
    .eq('id', itemId);
  return v;
}

export async function PUT(req: Request, { params }: Ctx) {
  const { itemId } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success || !b.data.relation) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const { data: item } = await a.sb
    .from('tm_items')
    .select('id, workspace_id')
    .eq('id', itemId)
    .maybeSingle();

  const { data: ev } = await a.sb
    .from('tm_evidence')
    .select('id, workspace_id')
    .eq('id', b.data.evidence_id)
    .maybeSingle();

  if (!item || !ev || item.workspace_id !== ev.workspace_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await a.sb.from('tm_item_evidence').upsert({
    item_id: itemId,
    evidence_id: ev.id,
    workspace_id: item.workspace_id,
    relation: b.data.relation,
  });

  const verification = await recompute(a.sb, itemId);
  await logEvent(a.sb, item.workspace_id, 'evidence_linked', { relation: b.data.relation });
  return NextResponse.json({ verification });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { itemId } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { data: item } = await a.sb
    .from('tm_items')
    .select('id, workspace_id')
    .eq('id', itemId)
    .maybeSingle();

  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await a.sb
    .from('tm_item_evidence')
    .delete()
    .eq('item_id', itemId)
    .eq('evidence_id', b.data.evidence_id);

  const verification = await recompute(a.sb, itemId);
  return NextResponse.json({ verification });
}
