export const STAGES = [
  'orient',
  'frame',
  'investigate',
  'diverge',
  'converge',
  'challenge',
  'validate',
  'communicate',
] as const;

export type Stage = (typeof STAGES)[number];

// Forward at most one step; backward to any earlier stage is always allowed
export function canMove(from: Stage, to: Stage): boolean {
  return STAGES.indexOf(to) <= STAGES.indexOf(from) + 1;
}

export type Counts = {
  hasMessages: boolean;
  frameConfirmed: boolean;
  claims: number;
  hypotheses: number;
  ideas: number;
  counterarguments: number;
  experiments: number;
  evidenceLinked: number;
  decided: boolean;
};

// A suggestion shown to the user, never applied automatically
export function suggestStage(c: Counts): Stage {
  if (!c.frameConfirmed) return c.hasMessages ? 'frame' : 'orient';
  if (c.decided && c.experiments > 0) return 'communicate';
  if (c.decided && c.counterarguments > 0) return 'validate';
  if (c.decided) return 'challenge';
  if (c.ideas >= 2) return 'converge';
  if (c.evidenceLinked >= 1 && c.claims + c.hypotheses >= 2) return 'diverge';
  return 'investigate';
}
