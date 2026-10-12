import { NextRequest, NextResponse } from 'next/server';
import { ModeTransitionRequestSchema, WorkflowStateMachine } from '@/services/workflow/state-machine';
import { SupabaseThinkingRepository } from '@/services/db/repository';

const repository = new SupabaseThinkingRepository();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ModeTransitionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid transition payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { sessionId, fromMode, toMode } = parsed.data;

    // Check actual persisted decision state from repository if sessionId is provided
    let hasAcceptedDecision = false;
    let insights = undefined;

    if (sessionId) {
      try {
        insights = await repository.getInsights(sessionId);
        hasAcceptedDecision = insights.some(
          (i) => i.category === 'decision' && i.status === 'accepted'
        );
      } catch {
        // If repository is offline or in local-first demo mode, fall back to parsed flag with caution
        hasAcceptedDecision = !!parsed.data.hasAcceptedDecision;
      }
    } else {
      hasAcceptedDecision = !!parsed.data.hasAcceptedDecision;
    }

    const validation = WorkflowStateMachine.validateTransition(fromMode, toMode, {
      hasAcceptedDecision,
      insights,
    });

    return NextResponse.json(validation);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error)?.message || 'Failed to validate transition' },
      { status: 500 }
    );
  }
}
