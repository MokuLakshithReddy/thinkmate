import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { getAuthenticatedUser } from '@/lib/server-auth';

const InsightMutationSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().min(1).max(100),
  category: z.enum(['goal', 'assumption', 'option', 'decision', 'action', 'uncertainty']),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
  status: z.enum(['accepted', 'rejected', 'under_review']).default('under_review'),
  metadata: z
    .record(
      z.string().max(50),
      z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(500)).max(20)])
    )
    .optional(),
});

const repository = new SupabaseThinkingRepository();

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Authentication required: please provide a valid Supabase bearer token' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = InsightMutationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid insight data', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const item = parsed.data;
    const insight = await repository.upsertInsight(
      {
        id: item.id || crypto.randomUUID(),
        sessionId: item.sessionId,
        category: item.category,
        title: item.title,
        content: item.content,
        status: item.status,
        metadata: item.metadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      authUser.id
    );

    return NextResponse.json({ insight });
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('unauthorized') || msg.includes('ownership')) {
      return NextResponse.json({ error: 'Unauthorized insight operation' }, { status: 403 });
    }
    console.error('Error in POST /api/insights:', err);
    return NextResponse.json({ error: 'Failed to save insight' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Authentication required: please provide a valid Supabase bearer token' },
        { status: 401 }
      );
    }

    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Insight ID is required' }, { status: 400 });
    }

    await repository.deleteInsight(id, authUser.id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('unauthorized') || msg.includes('ownership')) {
      return NextResponse.json({ error: 'Unauthorized insight operation' }, { status: 403 });
    }
    console.error('Error in DELETE /api/insights:', err);
    return NextResponse.json({ error: 'Failed to delete insight' }, { status: 500 });
  }
}
