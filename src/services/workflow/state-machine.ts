import { ThinkingMode, Insight } from '@/types';
import { z } from 'zod';

export interface TransitionValidationResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
  recommendedMode?: ThinkingMode;
}

export const ModeTransitionRequestSchema = z.object({
  sessionId: z.string().min(1),
  fromMode: z.enum(['understand', 'explore', 'challenge', 'decide', 'act']),
  toMode: z.enum(['understand', 'explore', 'challenge', 'decide', 'act']),
  reason: z.string().optional(),
  insightsCount: z.number().optional(),
  hasAcceptedDecision: z.boolean().optional(),
});

export type ModeTransitionRequest = z.infer<typeof ModeTransitionRequestSchema>;

const ALLOWED_DIRECT_TRANSITIONS: Record<ThinkingMode, ThinkingMode[]> = {
  understand: ['explore', 'challenge'],
  explore: ['challenge', 'decide', 'understand'],
  challenge: ['decide', 'explore', 'understand'],
  decide: ['act', 'explore', 'challenge', 'understand'],
  act: ['decide', 'understand', 'challenge'],
};

export class WorkflowStateMachine {
  /**
   * Validates whether a transition from fromMode to toMode is sound,
   * checking workflow guardrails and business rules.
   */
  static validateTransition(
    fromMode: ThinkingMode,
    toMode: ThinkingMode,
    context?: {
      hasOptions?: boolean;
      hasAcceptedDecision?: boolean;
      insights?: Insight[];
      userOverride?: boolean;
    }
  ): TransitionValidationResult {
    // Staying in same mode is always valid
    if (fromMode === toMode) {
      return { allowed: true };
    }

    // Direct transition check
    const allowedTargets = ALLOWED_DIRECT_TRANSITIONS[fromMode] || [];
    const isDirect = allowedTargets.includes(toMode);

    // Guardrail: Entering Act mode without any accepted decision
    if (toMode === 'act') {
      const hasAccepted =
        context?.hasAcceptedDecision ||
        context?.insights?.some((i) => i.category === 'decision' && i.status === 'accepted');

      if (!hasAccepted && !context?.userOverride) {
        return {
          allowed: false,
          reason: 'Cannot advance to Act mode without at least one approved conclusion or decision in Decide mode.',
          warning: 'Please review and accept an option in Decide mode before drafting concrete execution tasks.',
          recommendedMode: 'decide',
        };
      }
    }

    // Guardrail: Jumping from Understand straight to Decide
    if (fromMode === 'understand' && toMode === 'decide' && !context?.userOverride) {
      return {
        allowed: false,
        reason: 'Skipping divergence (Explore) and stress-testing (Challenge) leads to premature convergence.',
        warning: 'It is strongly recommended to explore at least 2 distinct approaches before deciding.',
        recommendedMode: 'explore',
      };
    }

    // Guardrail: Jumping from Understand straight to Act
    if (fromMode === 'understand' && toMode === 'act' && !context?.userOverride) {
      return {
        allowed: false,
        reason: 'Cannot transition directly from Understand to Act. You must explore alternatives and formalize decisions first.',
        recommendedMode: 'explore',
      };
    }

    if (!isDirect && !context?.userOverride) {
      return {
        allowed: false,
        reason: `Direct transition from ${fromMode} to ${toMode} is disallowed by state machine guardrails.`,
        warning: `Unconventional transition from ${fromMode} to ${toMode} requires explicit user override.`,
        recommendedMode: this.getNextRecommendedMode(fromMode, context?.insights),
      };
    }

    return { allowed: true };
  }

  static getNextRecommendedMode(
    currentMode: ThinkingMode,
    insights: Insight[] = []
  ): ThinkingMode {
    switch (currentMode) {
      case 'understand':
        return 'explore';
      case 'explore': {
        const hasOptions = insights.some((i) => i.category === 'option');
        return hasOptions ? 'challenge' : 'explore';
      }
      case 'challenge':
        return 'decide';
      case 'decide': {
        const hasAccepted = insights.some(
          (i) => i.category === 'decision' && i.status === 'accepted'
        );
        return hasAccepted ? 'act' : 'decide';
      }
      case 'act':
        return 'act';
    }
  }
}
