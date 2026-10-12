import { NextRequest, NextResponse } from 'next/server';
import { ThinkStreamRequestSchema } from '@/services/ai/types';
import { GeminiThinkingService } from '@/services/ai/gemini-service';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { SupabaseThinkingRepository } from '@/services/db/repository';

/**
 * SSE Token Streaming Endpoint for Freeform Generative Thinking.
 * Used for streaming live tokens, granular insight extraction, and mode switches
 * when streaming response chunks are requested.
 */
const repository = new SupabaseThinkingRepository();

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);

    // Rate Limiting: 40 req/min for authenticated, 15 req/min for anonymous
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    const rateLimitKey = authUser ? `stream:usr:${authUser.id}` : `stream:ip:${clientIp}`;
    const rateCheck = checkRateLimit(rateLimitKey, authUser ? 40 : 15, 60000);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded for streaming requests. Please wait a moment.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000)) },
        }
      );
    }

    const json = await req.json();
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

    // Verify session ownership if authenticated caller references a persisted session
    if (requestData.sessionId && authUser) {
      const session = await repository.getSession(requestData.sessionId, authUser.id);
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
          // API-01 Sanitized client error
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
