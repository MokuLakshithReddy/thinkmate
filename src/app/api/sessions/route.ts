import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { getAuthenticatedUser } from '@/lib/server-auth';

const CreateSessionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  problemStatement: z.string().min(1, 'Problem statement is required'),
  currentMode: z.enum(['understand', 'explore', 'challenge', 'decide', 'act']).default('understand'),
  currentStage: z.enum([
    'welcome',
    'describe_problem',
    'clarify_objective',
    'break_subproblems',
    'explore_perspectives',
    'challenge_assumptions',
    'check_satisfaction',
    'summarize_insights',
    'choose_action',
  ]).default('welcome'),
});

function getRepository() {
  return new SupabaseThinkingRepository();
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Authentication required: please provide a valid Supabase bearer token' },
        { status: 401 }
      );
    }

    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      const session = await getRepository().getSession(id, authUser.id);
      if (!session) {
        return NextResponse.json(
          { error: 'Session not found or unauthorized' },
          { status: 404 }
        );
      }
      const messages = await getRepository().getMessages(id, authUser.id);
      const insights = await getRepository().getInsights(id, authUser.id);
      return NextResponse.json({
        session: {
          ...session,
          messages,
          insights,
        },
      });
    }

    const sessions = await getRepository().getSessions(authUser.id);
    return NextResponse.json({ sessions });
  } catch (err: unknown) {
    console.error('Error fetching sessions:', err);
    return NextResponse.json(
      { error: 'Failed to retrieve sessions' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 65536) {
      return NextResponse.json(
        { error: 'Payload too large: request body exceeds 64KB limit' },
        { status: 413 }
      );
    }

    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Authentication required: please provide a valid Supabase bearer token' },
        { status: 401 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON payload in request body' },
        { status: 400 }
      );
    }

    const parsed = CreateSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid session payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { title, problemStatement, currentMode, currentStage } = parsed.data;
    const session = await getRepository().createSession(
      {
        id: crypto.randomUUID(),
        userId: authUser.id,
        title,
        problemStatement,
        currentMode,
        currentStage,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      authUser.id
    );

    return NextResponse.json({ session });
  } catch (err: unknown) {
    console.error('Error creating session:', err);
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
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

    const all = req.nextUrl.searchParams.get('all') === 'true';
    if (all) {
      const count = await getRepository().deleteAllUserSessions(authUser.id);
      return NextResponse.json({ success: true, count, wiped: true });
    }

    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Session ID or ?all=true is required' }, { status: 400 });
    }

    await getRepository().deleteSession(id, authUser.id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorMessage = (err as Error)?.message || '';
    if (errorMessage.includes('unauthorized') || errorMessage.includes('ownership')) {
      return NextResponse.json({ error: 'Unauthorized session operation' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
