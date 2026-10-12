import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CoThinkEngine } from '@/services/ai/cothink-engine';
import { CoThinkerStep } from '@/types';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { checkRateLimitAsync } from '@/lib/rate-limiter';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { WorkflowStateMachine } from '@/services/workflow/state-machine';

/**
 * Main Co-Thinker Stage Progression Endpoint.
 * Strictly requires authentication and an authoritative database-persisted session.
 * Enforces server-side transition guardrails, optimistic concurrency control,
 * authoritative message history, and fails closed on DB failures.
 */
const CoThinkRequestSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required for authenticated workflow execution'),
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
  clientRequestId: z.string().max(100).optional(),
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

    // Rate Limiting: 60 req/min for authenticated user with distributed support
    const rateCheck = await checkRateLimitAsync(`usr:${authUser.id}`, 60, 60000);
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
      clientRequestId,
    } = parsed.data;

    // 1. Authoritatively retrieve the persisted session owned by caller
    let session;
    try {
      session = await getRepository().getSession(sessionId, authUser.id);
    } catch (sessionFetchErr: unknown) {
      console.error('Database error fetching session:', sessionFetchErr);
      return NextResponse.json(
        { error: 'Database service unavailable while verifying session' },
        { status: 503 }
      );
    }

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized or non-existent session' },
        { status: 404 }
      );
    }

    // 2. Authoritatively retrieve message history from database
    let dbMessages;
    try {
      dbMessages = await getRepository().getMessages(sessionId, authUser.id);
    } catch (msgErr: unknown) {
      console.error('Failed to retrieve authoritative session messages:', msgErr);
      return NextResponse.json(
        { error: 'Database service unavailable while retrieving session messages' },
        { status: 503 }
      );
    }

    // 3. Authoritative stage alignment:
    // The persisted session stage is the single source of truth.
    // Requested processing stage must match current active stage (or welcome -> describe_problem on kickoff)
    const currentStage =
      session.currentStage ||
      WorkflowStateMachine.deriveCurrentStage(session.currentMode, dbMessages.length);

    const currentMode = session.currentMode;

    const isAllowedProcessingStage =
      step === currentStage || (currentStage === 'welcome' && step === 'describe_problem');

    if (!isAllowedProcessingStage) {
      return NextResponse.json(
        {
          error: `Workflow execution mismatch: requested processing stage "${step}" does not match the active session stage "${currentStage}".`,
          currentStage,
          requestedStage: step,
        },
        { status: 400 }
      );
    }

    // 4. Build authoritative conversation history from database
    const authoritativeHistory = dbMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 5. Process stage via AI thinking engine (run before persisting to avoid partial state if AI fails)
    const activeProblem = problemStatement || session.problemStatement;
    const result = await engine.processStep(
      {
        userName: authUser.email || userName,
        step: step as CoThinkerStep,
        problemStatement: activeProblem,
        clarifiedObjective,
        conversationHistory: authoritativeHistory,
        activeSessionTitle: session.title,
      },
      userMessage,
      selectedOptionId
    );

    if (result.executionMode === 'error') {
      return NextResponse.json(
        { error: result.message, executionMode: 'error' },
        { status: 503 }
      );
    }

    // 6. Validate proposed stage transition: currentStage -> result.nextStep
    const transitionValidation = WorkflowStateMachine.validateStageTransition(
      currentStage,
      result.nextStep
    );
    if (!transitionValidation.allowed) {
      console.error(
        `AI generated invalid stage transition from "${currentStage}" to "${result.nextStep}":`,
        transitionValidation.reason
      );
      return NextResponse.json(
        {
          error: `Invalid workflow stage transition generated by reasoning engine: "${currentStage}" to "${result.nextStep}".`,
          reason: transitionValidation.reason,
        },
        { status: 500 }
      );
    }

    // 7. Atomically persist with optimistic concurrency control.
    // Pass the expected (pre-read) stage and mode so the RPC can detect concurrent mutations
    // under the FOR UPDATE lock and reject stale requests.
    const nextMode = WorkflowStateMachine.getModeForStage(result.nextStep);
    try {
      const writeResult = await getRepository().recordWorkflowStep(
        {
          sessionId,
          userMessage: userMessage.trim() ? userMessage : undefined,
          assistantMessage: result.message,
          nextStage: result.nextStep,
          nextMode,
          expectedStage: currentStage as CoThinkerStep,
          expectedMode: currentMode,
          problemStatement: activeProblem,
          suggestedQuestions: result.options?.map((o) => o.label) || [],
          clientRequestId,
        },
        authUser.id
      );

      // Handle concurrency conflict: another request already advanced the session
      if (writeResult.isConflict) {
        // Reload the authoritative session state for the client
        const freshSession = await getRepository().getSession(sessionId, authUser.id);
        return NextResponse.json(
          {
            error: 'Session state has changed since your request was sent. Please reload the session.',
            currentStage: freshSession?.currentStage || currentStage,
            currentMode: freshSession?.currentMode || currentMode,
          },
          { status: 409 }
        );
      }
    } catch (persistErr: unknown) {
      console.error('Critical database persistence failure during workflow transition:', persistErr);
      // Fail closed: never return success if database persistence fails
      return NextResponse.json(
        {
          error: 'Database persistence error: failed to commit workflow transition to session',
        },
        { status: 503 }
      );
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
