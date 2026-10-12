import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CoThinkEngine } from '@/services/ai/cothink-engine';
import { CoThinkerStep } from '@/types';

/**
 * Main Co-Thinker Stage Progression Endpoint.
 * Powers the interactive dual-pane workflow UI through the 8 flowchart stages,
 * returning structured step choices, stage transitions, and explicit execution mode stamping.
 */
const CoThinkRequestSchema = z.object({
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
  userMessage: z.string().default(''),
  selectedOptionId: z.string().optional(),
  userName: z.string().default('Thinker'),
  problemStatement: z.string().optional(),
  clarifiedObjective: z.string().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .default([]),
});

const engine = new CoThinkEngine(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = CoThinkRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid co-thinker payload', details: parsed.error.format() },
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
      },
      userMessage,
      selectedOptionId
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('Co-think error:', err);
    return NextResponse.json(
      { error: (err as Error)?.message || 'Co-think processing failure' },
      { status: 500 }
    );
  }
}
