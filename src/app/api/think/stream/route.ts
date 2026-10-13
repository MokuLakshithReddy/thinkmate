import { NextRequest, NextResponse } from 'next/server';
import { ThinkStreamRequestSchema } from '@/services/ai/types';
import { GeminiThinkingService } from '@/services/ai/gemini-service';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { checkRateLimitAsync } from '@/lib/rate-limiter';
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
    // 0. Bounded request size check at application layer (max 64KB)
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 65536) {
      return NextResponse.json(
        { error: 'Payload too large: request body exceeds 64KB limit' },
        { status: 413 }
      );
    }

    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded for streaming requests. Please wait a moment.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000)) },
        }
      );
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON payload in request body' },
        { status: 400 }
      );
    }

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

    // Verify session ownership for persisted session
    if (requestData.sessionId) {
      const session = await getRepository().getSession(requestData.sessionId, authUser.id);
      if (!session) {
        return NextResponse.json(
          { error: 'Unauthorized or non-existent session' },
          { status: 404 }
        );
      }
    }

    const aiService = new GeminiThinkingService(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          await aiService.generateThinkingStream(requestData, (event) => {
            const payload = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          });

          // Done signal
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (streamErr: unknown) {
          console.error('Error during streaming execution:', streamErr);
          const errPayload = `data: ${JSON.stringify({
            type: 'error',
            error: 'Streaming generation encountered a temporary failure. Please retry.',
          })}\n\n`;
          controller.enqueue(encoder.encode(errPayload));
          controller.close();
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
