import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SupabaseThinkingRepository } from '@/services/db/repository';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { STAGE_TO_MODE, MODE_TO_DEFAULT_STAGE } from '@/services/workflow/state-machine';
import { readBoundedJson } from '@/lib/request-utils';
import { checkRateLimitAsync, createRateLimitErrorResponse } from '@/lib/rate-limiter';
import { checkCsrfOrForbidden } from '@/lib/csrf';

const CreateSessionSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(120),
    problemStatement: z.string().min(1, 'Problem statement is required'),
    currentMode: z.enum(['understand', 'explore', 'challenge', 'decide', 'act']).default('understand'),
    currentStage: z
      .enum([
        'welcome',
        'describe_problem',
        'clarify_objective',
        'break_subproblems',
        'explore_perspectives',
        'challenge_assumptions',
        'check_satisfaction',
        'summarize_insights',
        'choose_action',
      ])
      .optional(),
  })
  .refine(
    (data) => {
      if (data.currentStage) {
        return STAGE_TO_MODE[data.currentStage] === data.currentMode;
      }
      return true;
    },
    {
      message: 'Incompatible mode and stage combination: specified stage does not align with mode',
      path: ['currentStage'],
    }
  );

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

    // Rate Limiting: 120 req/min for authenticated session reads
    const rateCheck = await checkRateLimitAsync(`read:sessions:${authUser.id}`, 120, 60000);
    if (!rateCheck.allowed) {
      return createRateLimitErrorResponse(rateCheck, 'Rate limit exceeded: too many session read requests. Please wait before retrying.');
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
    const msg = (err as Error)?.message || '';
    if (msg.includes('unauthorized') || msg.includes('ownership')) {
      return NextResponse.json(
        { error: 'Unauthorized or non-existent session' },
        { status: 404 }
      );
    }
    console.error('Error fetching sessions:', err);
    return NextResponse.json(
      { error: 'Failed to retrieve sessions' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const csrfError = checkCsrfOrForbidden(req);
    if (csrfError) return csrfError;

    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Authentication required: please provide a valid Supabase bearer token' },
        { status: 401 }
      );
    }

    // Rate Limiting: 30 req/min for authenticated session mutations (create)
    const rateCheck = await checkRateLimitAsync(`mutation:sessions:${authUser.id}`, 30, 60000);
    if (!rateCheck.allowed) {
      return createRateLimitErrorResponse(rateCheck, 'Rate limit exceeded: too many session creation requests. Please wait before retrying.');
    }

    const bodyResult = await readBoundedJson(req, 65536);
    if (bodyResult.error) {
      return NextResponse.json(
        { error: bodyResult.error },
        { status: bodyResult.status || 400 }
      );
    }

    const parsed = CreateSessionSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid session payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { title, problemStatement, currentMode, currentStage } = parsed.data;
    const effectiveStage = currentStage || (currentMode === 'understand' ? 'welcome' : MODE_TO_DEFAULT_STAGE[currentMode]);

    const session = await getRepository().createSession(
      {
        id: crypto.randomUUID(),
        userId: authUser.id,
        title,
        problemStatement,
        currentMode,
        currentStage: effectiveStage,
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
    const csrfError = checkCsrfOrForbidden(req);
    if (csrfError) return csrfError;

    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Authentication required: please provide a valid Supabase bearer token' },
        { status: 401 }
      );
    }

    // Rate Limiting: 30 req/min for authenticated session mutations (delete)
    const rateCheck = await checkRateLimitAsync(`mutation:sessions:${authUser.id}`, 30, 60000);
    if (!rateCheck.allowed) {
      return createRateLimitErrorResponse(rateCheck, 'Rate limit exceeded: too many session deletion requests. Please wait before retrying.');
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
    const errorMessage = ((err as Error)?.message || '').toLowerCase();
    if (errorMessage.includes('unauthorized') || errorMessage.includes('ownership') || errorMessage.includes('forbidden')) {
      return NextResponse.json({ error: 'Unauthorized session operation' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
