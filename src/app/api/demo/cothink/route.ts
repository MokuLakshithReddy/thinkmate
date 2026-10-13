import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CoThinkEngine } from '@/services/ai/cothink-engine';
import { CoThinkerStep } from '@/types';
import { checkRateLimitAsync, getClientIp } from '@/lib/rate-limiter';
import { readBoundedJson } from '@/lib/request-utils';

/**
 * Isolated Unauthenticated Demo Endpoint.
 * Strictly separates anonymous playground interactions from production authenticated AI routes.
 * Never touches the database or consumes production AI quota.
 * Always operates in explicit deterministic simulation mode with strict IP rate limiting.
 */
const DemoCoThinkRequestSchema = z.object({
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
  userMessage: z.string().max(4000, 'Demo message cannot exceed 4,000 characters').default(''),
  selectedOptionId: z.string().max(100).optional(),
  userName: z.string().max(50).default('Demo Thinker'),
  problemStatement: z.string().max(4000).optional(),
  clarifiedObjective: z.string().max(2000).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      })
    )
    .max(20, 'Demo conversation history cannot exceed 20 turns')
    .default([]),
});

const engine = new CoThinkEngine();

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    // Rate Limiting: 20 req/min for anonymous demo traffic with distributed support
    const rateCheck = await checkRateLimitAsync(`demo:ip:${clientIp}`, 20, 60000);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Demo rate limit exceeded. Please wait a moment before trying again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000)) },
        }
      );
    }

    const bodyResult = await readBoundedJson(req, 65536);
    if (bodyResult.error) {
      return NextResponse.json(
        { error: bodyResult.error },
        { status: bodyResult.status || 400 }
      );
    }
    const json = bodyResult.data;
    const parsed = DemoCoThinkRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid demo request payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const {
      step,
      userMessage,
      selectedOptionId,
      userName,
      problemStatement,
      clarifiedObjective,
      history,
    } = parsed.data;

    const result = await engine.processStep(
      {
        userName,
        step: step as CoThinkerStep,
        problemStatement,
        clarifiedObjective,
        conversationHistory: history,
        isDemo: true, // Forces explicit deterministic simulator
      },
      userMessage,
      selectedOptionId
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('Demo co-think error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred in demo processing.' },
      { status: 500 }
    );
  }
}
