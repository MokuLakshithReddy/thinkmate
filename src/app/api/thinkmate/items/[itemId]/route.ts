import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';
import { flags } from '@/lib/thinkmate/flags';
import { embed } from '@/lib/thinkmate/retrieval';

const Body = z.object({
  action: z.enum(['confirm', 'reject', 'edit']),
  text: z.string().trim().min(3).max(500).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const a = await authed();
  if (!a) return unauthorized();

  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success || (b.data.action === 'edit' && !b.data.text)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const patch: Record<string, unknown> =
    b.data.action === 'reject'
      ? { status: 'rejected' }
      : b.data.action === 'confirm'
      ? { status: 'confirmed' }
      : { status: 'confirmed', text: b.data.text };

  // Embedding update on confirm/edit if vector retrieval is active (Layer 4)
  if (flags.retrieval === 'vector' && (b.data.action === 'confirm' || b.data.action === 'edit')) {
    try {
      const textToEmbed = (b.data.text ?? patch.text) as string | undefined;
      if (textToEmbed) {
        const [vector] = await embed([textToEmbed], 'RETRIEVAL_DOCUMENT');
        if (vector) {
          patch.embedding = vector;
        }
      }
    } catch {
      // Embedding failure must never block confirmation
    }
  }

  const { data } = await a.sb
    .from('tm_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .select()
    .maybeSingle();

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await logEvent(a.sb, data.workspace_id, 'item_' + b.data.action, {
    kind: data.kind,
    origin: data.origin,
  });

  return NextResponse.json(data);
}
