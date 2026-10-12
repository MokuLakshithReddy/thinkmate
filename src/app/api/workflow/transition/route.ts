import { NextRequest, NextResponse } from 'next/server';
import { ModeTransitionRequestSchema, WorkflowStateMachine } from '@/services/workflow/state-machine';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { getAuthenticatedUser } from '@/lib/server-auth';

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
    const parsed = ModeTransitionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid transition payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { sessionId, fromMode, toMode } = parsed.data;

    // Verify session exists and is owned by the authenticated caller
    const session = await repository.getSession(sessionId, authUser.id);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized or non-existent session' },
        { status: 404 }
      );
    }

    // Authoritatively retrieve persisted insights for this user's session
    let insights;
    try {
      insights = await repository.getInsights(sessionId, authUser.id);
    } catch (err: unknown) {
      console.error('Failed to retrieve session insights for transition:', err);
      // Fail closed when database is unavailable: never allow client-supplied state to forge transitions
      return NextResponse.json(
        { error: 'Database service unavailable for decision verification. Transition denied.' },
        { status: 503 }
      );
    }

    const hasAcceptedDecision = insights.some(
      (i) => i.category === 'decision' && i.status === 'accepted'
    );

    const validation = WorkflowStateMachine.validateTransition(fromMode, toMode, {
      hasAcceptedDecision,
      insights,
    });

    return NextResponse.json(validation);
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('unauthorized') || msg.includes('ownership')) {
      return NextResponse.json({ error: 'Unauthorized workflow operation' }, { status: 403 });
    }
    console.error('Workflow transition error:', err);
    return NextResponse.json(
      { error: 'Internal error validating workflow transition' },
      { status: 500 }
    );
  }
}
