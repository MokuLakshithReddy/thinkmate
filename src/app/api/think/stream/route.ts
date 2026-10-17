import { NextRequest, NextResponse } from 'next/server';
import { ThinkStreamRequestSchema } from '@/services/ai/types';
import { GeminiThinkingService } from '@/services/ai/gemini-service';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { checkRateLimitAsync, createRateLimitErrorResponse } from '@/lib/rate-limiter';
import { SupabaseThinkingRepository } from '@/services/db/repository';

/**
 * SSE Token Streaming Endpoint for Freeform Generative Thinking.
 * Strictly requires authentication to prevent unauthenticated resource consumption.
 * Verifies session ownership and streams real reasoning tokens.
 */
let repositoryInstance: SupabaseThinkingRepository | null = null;
function getRepository() {
  if (!repositoryInstance) {
    repositoryInstance = new SupabaseThinkingRepository();
  }
  return repositoryInstance;
}

import { readBoundedJson } from '@/lib/request-utils';

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        {
          error: 'Authentication required: please provide a valid Supabase bearer token.',
        },
        { status: 401 }
      );
    }

    // Rate Limiting: 40 req/min for authenticated user with distributed support
    const rateCheck = await checkRateLimitAsync(`stream:usr:${authUser.id}`, 40, 60000);
    if (!rateCheck.allowed) {
      return createRateLimitErrorResponse(rateCheck, 'Rate limit exceeded for streaming requests. Please wait a moment.');
    }

    // 0. Enforce real streaming byte limits and catch malformed JSON
    const bodyResult = await readBoundedJson(req, 65536);
    if (bodyResult.error) {
      return NextResponse.json(
        { error: bodyResult.error },
        { status: bodyResult.status || 400 }
      );
    }
    const json = bodyResult.data;

    const validation = ThinkStreamRequestSchema.safeParse(json);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid thinking request payload',
          details: validation.error.format(),
        },
        { status: 400 }
      );
    }

    const requestData = validation.data;

    // Verify session ownership and enforce authoritative workflow state machine rules
    if (requestData.sessionId) {
      const session = await getRepository().getSession(requestData.sessionId, authUser.id);
      if (!session) {
        return NextResponse.json(
          { error: 'Unauthorized or non-existent session' },
          { status: 404 }
        );
      }

      // Authoritative mode alignment: client cannot stream against an incompatible mode
      if (requestData.currentMode !== session.currentMode) {
        return NextResponse.json(
          {
            error: `Workflow execution mismatch: requested mode "${requestData.currentMode}" does not match active session mode "${session.currentMode}".`,
            sessionMode: session.currentMode,
            requestedMode: requestData.currentMode,
          },
          { status: 400 }
        );
      }

      // Decision Gate check: acting mode requires at least one accepted decision insight
      if (requestData.currentMode === 'act') {
        const insights = await getRepository().getInsights(requestData.sessionId, authUser.id);
        const hasAcceptedDecision = insights.some(
          (i) => i.category === 'decision' && i.status === 'accepted'
        );
        if (!hasAcceptedDecision) {
          return NextResponse.json(
            {
              error: 'Workflow transition denied: cannot execute in "act" mode without at least one accepted decision insight.',
            },
            { status: 400 }
          );
        }
      }
    }

    const aiService = new GeminiThinkingService(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    const encoder = new TextEncoder();
    let isAborted = false;
    let isClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const onAbort = () => {
          isAborted = true;
          if (!isClosed) {
            isClosed = true;
            try {
              controller.close();
            } catch {}
          }
        };

        if (req.signal.aborted) {
          onAbort();
          return;
        }

        req.signal.addEventListener('abort', onAbort);

        try {
          await aiService.generateThinkingStream(
            requestData,
            (event) => {
              if (isAborted || isClosed || req.signal.aborted) return;
              try {
                const payload = `data: ${JSON.stringify(event)}\n\n`;
                controller.enqueue(encoder.encode(payload));
              } catch {}
            },
            req.signal
          );

          if (!isAborted && !isClosed) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            isClosed = true;
            controller.close();
          }
        } catch (streamErr: unknown) {
          if (isAborted || req.signal.aborted) return;
          console.error('Error during streaming execution:', streamErr);
          if (!isClosed) {
            try {
              const errPayload = `data: ${JSON.stringify({
                type: 'error',
                error: 'Streaming generation encountered a temporary failure. Please retry.',
              })}\n\n`;
              controller.enqueue(encoder.encode(errPayload));
              isClosed = true;
              controller.close();
            } catch {}
          }
        } finally {
          req.signal.removeEventListener('abort', onAbort);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: unknown) {
    console.error('API route error in /api/think/stream:', error);
    return NextResponse.json(
      { error: 'Internal server error processing thinking stream' },
      { status: 500 }
    );
  }
}
