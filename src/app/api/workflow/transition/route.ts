import { NextRequest, NextResponse } from 'next/server';
import { ModeTransitionRequestSchema, WorkflowStateMachine } from '@/services/workflow/state-machine';

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

    const { fromMode, toMode, hasAcceptedDecision } = parsed.data;

    const validation = WorkflowStateMachine.validateTransition(fromMode, toMode, {
      hasAcceptedDecision,
    });

    return NextResponse.json(validation);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to validate transition' },
      { status: 500 }
    );
  }
}
