import { NextRequest, NextResponse } from 'next/server';
import { ThinkStreamRequestSchema } from '@/services/ai/types';
import { GeminiThinkingService } from '@/services/ai/gemini-service';

/**
 * SSE Token Streaming Endpoint for Freeform Generative Thinking.
 * Used for streaming live tokens, granular insight extraction, and mode switches
 * when streaming response chunks are requested.
 */
export async function POST(req: NextRequest) {
  try {
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
            error: (streamErr as Error)?.message || 'Streaming failure',
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
