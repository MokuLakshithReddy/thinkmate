import { CoThinkerStep, ThinkingMode, Insight } from '@/types';
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

export const STAGE_TO_MODE: Record<CoThinkerStep, ThinkingMode> = {
  welcome: 'understand',
  describe_problem: 'understand',
  clarify_objective: 'understand',
  break_subproblems: 'explore',
  explore_perspectives: 'explore',
  challenge_assumptions: 'challenge',
  check_satisfaction: 'challenge',
  summarize_insights: 'decide',
  choose_action: 'act',
};

export const ALLOWED_STAGE_TRANSITIONS: Record<CoThinkerStep, CoThinkerStep[]> = {
  welcome: ['welcome', 'describe_problem'],
  describe_problem: ['describe_problem', 'clarify_objective', 'welcome'],
  clarify_objective: ['clarify_objective', 'break_subproblems', 'describe_problem'],
  break_subproblems: ['break_subproblems', 'explore_perspectives', 'clarify_objective'],
  explore_perspectives: ['explore_perspectives', 'challenge_assumptions', 'break_subproblems'],
  challenge_assumptions: ['challenge_assumptions', 'check_satisfaction', 'explore_perspectives'],
  check_satisfaction: ['check_satisfaction', 'summarize_insights', 'explore_perspectives', 'challenge_assumptions'],
  summarize_insights: ['summarize_insights', 'choose_action', 'explore_perspectives'],
  choose_action: ['choose_action', 'summarize_insights'],
};

const ALLOWED_DIRECT_TRANSITIONS: Record<ThinkingMode, ThinkingMode[]> = {
  understand: ['explore', 'challenge'],
  explore: ['challenge', 'decide', 'understand'],
  challenge: ['decide', 'explore', 'understand'],
  decide: ['act', 'explore', 'challenge', 'understand'],
  act: ['decide', 'understand', 'challenge'],
};

export const MODE_TO_DEFAULT_STAGE: Record<ThinkingMode, CoThinkerStep> = {
  understand: 'describe_problem',
  explore: 'explore_perspectives',
  challenge: 'challenge_assumptions',
  decide: 'summarize_insights',
  act: 'choose_action',
};

export class WorkflowStateMachine {
  /**
   * Authoritatively checks if transitioning from one flowchart stage to another is legal.
   */
  static validateStageTransition(
    fromStep: CoThinkerStep,
    toStep: CoThinkerStep,
    context?: {
      hasAcceptedDecision?: boolean;
    }
  ): { allowed: boolean; reason?: string } {
    if (fromStep === toStep) return { allowed: true };
    const allowed = ALLOWED_STAGE_TRANSITIONS[fromStep] || [];
    if (!allowed.includes(toStep)) {
      return {
        allowed: false,
        reason: `Illegal workflow stage jump from "${fromStep}" to "${toStep}". Stages must progress through the Co-Thinker reasoning pipeline.`,
      };
    }

    // Server-enforced decision gate: Cannot enter choose_action without an accepted decision
    if (toStep === 'choose_action' && !context?.hasAcceptedDecision) {
      return {
        allowed: false,
        reason: 'Cannot transition to action execution ("choose_action") without at least one approved decision insight recorded in Decide mode.',
      };
    }

    return { allowed: true };
  }

  /**
   * Derives current flowchart stage. Prioritizes the authoritative persistedStage field.
   * Message count is only used as a legacy fallback when persistedStage is absent.
   */
  static deriveCurrentStage(
    currentMode: ThinkingMode,
    messageCount: number,
    persistedStage?: CoThinkerStep
  ): CoThinkerStep {
    if (persistedStage) {
      return persistedStage;
    }
    if (currentMode === 'understand') {
      if (messageCount === 0) return 'welcome';
      if (messageCount <= 2) return 'describe_problem';
      return 'clarify_objective';
    }
    return MODE_TO_DEFAULT_STAGE[currentMode] || 'welcome';
  }

  /**
   * Resolves the authoritative mode corresponding to a flowchart stage.
   */
  static getModeForStage(step: CoThinkerStep): ThinkingMode {
    return STAGE_TO_MODE[step] || 'understand';
  }

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
