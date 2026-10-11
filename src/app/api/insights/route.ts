import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SupabaseThinkingRepository } from '@/services/db/repository';

const InsightMutationSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().min(1),
  category: z.enum(['goal', 'assumption', 'option', 'decision', 'action', 'uncertainty']),
  title: z.string().min(1),
  content: z.string().min(1),
  status: z.enum(['accepted', 'rejected', 'under_review']).default('under_review'),
  metadata: z.record(z.string(), z.any()).optional(),
});

const repository = new SupabaseThinkingRepository();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = InsightMutationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid insight data', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const item = parsed.data;
    const insight = await repository.upsertInsight({
      id: item.id || crypto.randomUUID(),
      sessionId: item.sessionId,
      category: item.category,
      title: item.title,
      content: item.content,
      status: item.status,
      metadata: item.metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ insight });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to save insight' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Insight ID is required' }, { status: 400 });
    }
    await repository.deleteInsight(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to delete insight' }, { status: 500 });
  }
}
