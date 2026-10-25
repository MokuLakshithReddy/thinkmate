import type { Stage } from './stages';

export type Action =
  | 'ask'
  | 'clarify'
  | 'hint'
  | 'reframe'
  | 'request_evidence'
  | 'challenge'
  | 'expand'
  | 'compare'
  | 'explain'
  | 'example'
  | 'summarize'
  | 'validate';

export type Signals = {
  mode: 'guide' | 'balanced' | 'ideas';
  stage: Stage;
  directRequest: boolean;
  frameConfirmed: boolean;
  frameText: string | null;
  questionStreak: number;
  stuck: boolean;
  unsupportedConfirmed: number;
  ideas: number;
  turnsSinceSummary: number;
  decided: boolean;
  lastAction: string | null;
};

export function chooseAction(s: Signals): Action {
  let a: Action = pick(s);
  // Guide mode never volunteers ideas or examples; the user must ask or be stuck repeatedly
  if (s.mode === 'guide' && (a === 'expand' || a === 'example') && !s.directRequest && s.questionStreak < 3) {
    a = 'hint';
  }
  return a;
}

function pick(s: Signals): Action {
  if (s.directRequest) return s.mode === 'ideas' ? 'example' : 'explain';
  if (s.questionStreak >= 3) return s.stuck ? 'example' : 'hint';
  if (s.turnsSinceSummary >= 12) return 'summarize';
  if (!s.frameConfirmed) return s.stage === 'orient' ? 'ask' : 'clarify';
  if (s.stage === 'frame' && s.frameText && s.frameText.length < 60) return 'reframe';
  if (
    s.unsupportedConfirmed > 0 &&
    s.lastAction !== 'request_evidence' &&
    ['investigate', 'diverge', 'converge'].includes(s.stage)
  ) {
    return 'request_evidence';
  }
  if (s.stuck) return 'hint';

  switch (s.stage) {
    case 'diverge':
      return s.mode === 'ideas' ? 'expand' : 'ask';
    case 'converge':
      return s.ideas >= 2 ? 'compare' : 'expand';
    case 'challenge':
      return 'challenge';
    case 'validate':
      return 'validate';
    case 'communicate':
      return 'summarize';
    default:
      return 'ask';
  }
}

export const ACTION_TEXT: Record<Action, string> = {
  ask: 'Ask one open question that helps the user explain their current understanding.',
  clarify: 'Ask one question that removes an ambiguity in the problem or in the last statement.',
  hint: 'Give one small hint that points a direction without giving the solution.',
  reframe: 'Point out that the problem frame may be too broad, narrow or solution-first, and ask how they would restate it.',
  request_evidence:
    'Pick the most important confirmed claim with no evidence attached and ask what they have seen or could check to support or contradict it.',
  challenge: 'Offer one counterexample or competing explanation against the favoured idea or claim.',
  expand: 'Offer two or three materially different directions, one line each, then ask which they would defend.',
  compare: 'Ask which criteria matter most, then compare the leading ideas against them briefly.',
  explain: 'Explain the requested point briefly, state its assumptions, and invite critique.',
  example: 'Give one concrete example the user can adapt or critique, and say it is only an example.',
  summarize: 'Summarize what is confirmed, what is uncertain and the next open question in five lines or fewer.',
  validate:
    'Help design the cheapest test that could prove the choice wrong: what to observe, who to ask, what result changes the plan.',
};

export const STAGE_GOAL: Record<Stage, string> = {
  orient: 'Understand the challenge and what the user wants from it.',
  frame: 'Reach a specific problem statement with scope and stakeholders.',
  investigate: 'Separate what is known from what is assumed; find causes and evidence.',
  diverge: 'Widen the set of possible approaches.',
  converge: 'Compare options against explicit criteria.',
  challenge: 'Test the chosen option against weak assumptions and alternatives.',
  validate: 'Define experiments that could change the decision.',
  communicate: 'Prepare to explain and defend the decision.',
};
