import { NextRequest, NextResponse } from 'next/server';
import { ModeTransitionRequestSchema, WorkflowStateMachine } from '@/services/workflow/state-machine';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { getAuthenticatedUser } from '@/lib/server-auth';

let repositoryInstance: SupabaseThinkingRepository | null = null;
function getRepository() {
  if (!repositoryInstance) {
    repositoryInstance = new SupabaseThinkingRepository();
  }
  return repositoryInstance;
}

export async function POST(req: NextRequest) {
  try {
    // 0. Bounded request size check at application layer (max 64KB)
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

    // Explicitly catch malformed JSON and return 400 Bad Request
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON payload in request body' },
        { status: 400 }
      );
    }

    const parsed = ModeTransitionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid transition payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { sessionId, fromMode, toMode, reason } = parsed.data;

    // Verify session exists and is owned by the authenticated caller
    const session = await getRepository().getSession(sessionId, authUser.id);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized or non-existent session' },
        { status: 404 }
      );
    }

    // Verify fromMode matches the database source of truth
    if (fromMode && fromMode !== session.currentMode) {
      return NextResponse.json(
        {
          error: `Workflow mode mismatch: request claimed fromMode "${fromMode}", but session is currently in "${session.currentMode}".`,
          currentMode: session.currentMode,
          requestedFromMode: fromMode,
        },
        { status: 400 }
      );
    }

    const authoritativeFromMode = session.currentMode;

    // Authoritatively retrieve persisted insights for this user's session
    let insights;
    try {
      insights = await getRepository().getInsights(sessionId, authUser.id);
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

    const validation = WorkflowStateMachine.validateTransition(authoritativeFromMode, toMode, {
      hasAcceptedDecision,
      insights,
    });

    if (!validation.allowed) {
      return NextResponse.json({
        ...validation,
        persistedMode: session.currentMode,
      });
    }

    // Atomically execute transition under PostgreSQL row lock
    try {
      const txResult = await getRepository().transitionMode(
        {
          sessionId,
          expectedMode: authoritativeFromMode,
          toMode,
          reason,
        },
        authUser.id
      );

      if (txResult.isConflict) {
        const freshSession = await getRepository().getSession(sessionId, authUser.id);
        return NextResponse.json(
          {
            error: 'Session mode has changed concurrently since your request was sent. Please reload.',
            currentMode: freshSession?.currentMode || session.currentMode,
          },
          { status: 409 }
        );
      }

      if (!txResult.allowed) {
        return NextResponse.json(
          {
            allowed: false,
            reason: 'Transition preconditions not met in database state.',
            persistedMode: session.currentMode,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ...validation,
        persistedMode: toMode,
        stage: txResult.stage,
      });
    } catch (txErr: unknown) {
      console.error('Failed to commit atomic mode transition:', txErr);
      return NextResponse.json(
        { error: 'Failed to persist validated workflow transition to database' },
        { status: 503 }
      );
    }
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
