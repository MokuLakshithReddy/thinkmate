import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CoThinkEngine } from '@/services/ai/cothink-engine';
import { CoThinkerStep } from '@/types';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { WorkflowStateMachine } from '@/services/workflow/state-machine';

/**
 * Main Co-Thinker Stage Progression Endpoint.
 * Strictly requires authentication to prevent unauthenticated resource consumption.
 * Validates session ownership and authoritatively updates persisted workflow mode.
 */
const CoThinkRequestSchema = z.object({
  sessionId: z.string().max(100).optional(),
  step: z.enum([
    'welcome',
    'describe_problem',
    'clarify_objective',
    'break_subproblems',
    'explore_perspectives',
    'challenge_assumptions',
    'check_satisfaction',
    'summarize_insights',
    'choose_action',
  ]),
  userMessage: z.string().max(8000, 'User message exceeds 8,000 character limit').default(''),
  selectedOptionId: z.string().max(100).optional(),
  userName: z.string().max(50).default('Thinker'),
  problemStatement: z.string().max(8000, 'Problem statement exceeds 8,000 character limit').optional(),
  clarifiedObjective: z.string().max(4000, 'Clarified objective exceeds 4,000 character limit').optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8000),
      })
    )
    .max(50, 'Conversation history cannot exceed 50 turns')
    .default([]),
});

const engine = new CoThinkEngine(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
let repositoryInstance: SupabaseThinkingRepository | null = null;
function getRepository() {
  if (!repositoryInstance) {
    repositoryInstance = new SupabaseThinkingRepository();
  }
  return repositoryInstance;
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        {
          error: 'Authentication required: please provide a valid Supabase bearer token. For unauthenticated demos, use /api/demo/cothink.',
        },
        { status: 401 }
      );
    }

    // Rate Limiting: 60 req/min for authenticated user
    const rateCheck = checkRateLimit(`usr:${authUser.id}`, 60, 60000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait a moment before sending more messages.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000)) },
        }
      );
    }

    const json = await req.json();
    const parsed = CoThinkRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid co-thinker payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const {
      sessionId,
      step,
      userMessage,
      selectedOptionId,
      userName,
      problemStatement,
      clarifiedObjective,
      history,
    } = parsed.data;

    // Verify session ownership if sessionId is supplied
    if (sessionId) {
      const session = await getRepository().getSession(sessionId, authUser.id);
      if (!session) {
        return NextResponse.json(
          { error: 'Unauthorized or non-existent session' },
          { status: 404 }
        );
      }
    }

    const result = await engine.processStep(
      {
        userName: authUser.email || userName,
        step: step as CoThinkerStep,
        problemStatement,
        clarifiedObjective,
        conversationHistory: history,
      },
      userMessage,
      selectedOptionId
    );

    // If caller owns this session, authoritatively update currentMode in the database
    if (sessionId && result.nextStep) {
      try {
        const nextMode = WorkflowStateMachine.getModeForStage(result.nextStep);
        await getRepository().updateSession(sessionId, { currentMode: nextMode }, authUser.id);
      } catch (err: unknown) {
        console.warn('Could not persist stage update to session:', err);
      }
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('Co-think error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred during thinking processing. Please retry.' },
      { status: 500 }
    );
  }
}
