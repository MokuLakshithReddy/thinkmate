import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SupabaseThinkingRepository } from '@/services/db/repository';

const CreateSessionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  problemStatement: z.string().min(1, 'Problem statement is required'),
  currentMode: z.enum(['understand', 'explore', 'challenge', 'decide', 'act']).default('understand'),
  userId: z.string().optional(),
});

const repository = new SupabaseThinkingRepository();

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId') || undefined;
    const sessions = await repository.getSessions(userId);
    return NextResponse.json({ sessions });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to list sessions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid session payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { title, problemStatement, currentMode, userId } = parsed.data;
    const session = await repository.createSession({
      id: crypto.randomUUID(),
      userId: userId || 'anonymous',
      title,
      problemStatement,
      currentMode,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ session });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to create session' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    const userId = req.nextUrl.searchParams.get('userId') || undefined;

    if (!id) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    await repository.deleteSession(id, userId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to delete session' }, { status: 500 });
  }
}
