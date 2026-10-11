export type ThinkingMode = 'understand' | 'explore' | 'challenge' | 'decide' | 'act';

export interface ModeConfig {
  id: ThinkingMode;
  name: string;
  tagline: string;
  description: string;
  objective: string;
  color: string;
  accentClass: string;
  bgClass: string;
  borderClass: string;
  badgeClass: string;
}

export const THINKING_MODES: Record<ThinkingMode, ModeConfig> = {
  understand: {
    id: 'understand',
    name: 'Understand',
    tagline: 'Clarify the real problem',
    description: 'Deconstruct symptoms, reveal hidden constraints, and articulate the true objective.',
    objective: 'Probe assumptions, question problem framing, and isolate what success looks like.',
    color: '#818cf8',
    accentClass: 'text-indigo-400',
    bgClass: 'bg-indigo-500/10',
    borderClass: 'border-indigo-500/30',
    badgeClass: 'bg-indigo-950/70 text-indigo-300 border-indigo-700/50',
  },
  explore: {
    id: 'explore',
    name: 'Explore',
    tagline: 'Divergent solution paths',
    description: 'Generate distinct, high-leverage approaches with explicit trade-offs and risks.',
    objective: 'Avoid early convergence; evaluate unconventional angles and architectural alternatives.',
    color: '#38bdf8',
    accentClass: 'text-sky-400',
    bgClass: 'bg-sky-500/10',
    borderClass: 'border-sky-500/30',
    badgeClass: 'bg-sky-950/70 text-sky-300 border-sky-700/50',
  },
  challenge: {
    id: 'challenge',
    name: 'Challenge',
    tagline: 'Stress-test & red team',
    description: 'Audit unproven assumptions, model worst-case failure modes, and surface blind spots.',
    objective: 'Separate verified facts from assumptions; simulate stress and execution friction.',
    color: '#fbbf24',
    accentClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    badgeClass: 'bg-amber-950/70 text-amber-300 border-amber-700/50',
  },
  decide: {
    id: 'decide',
    name: 'Decide',
    tagline: 'Convergent trade-off evaluation',
    description: 'Compare multi-criteria trade-offs, evaluate weights, and lock in approved directions.',
    objective: 'Present clear choices, record explicit trade-offs, and secure user consent.',
    color: '#34d399',
    accentClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    badgeClass: 'bg-emerald-950/70 text-emerald-300 border-emerald-700/50',
  },
  act: {
    id: 'act',
    name: 'Act',
    tagline: 'Execution & roadmapping',
    description: 'Convert approved decisions into actionable milestones, next steps, and stop conditions.',
    objective: 'Define immediate next actions, assign ownership criteria, and establish definition of done.',
    color: '#06b6d4',
    accentClass: 'text-cyan-400',
    bgClass: 'bg-cyan-500/10',
    borderClass: 'border-cyan-500/30',
    badgeClass: 'bg-cyan-950/70 text-cyan-300 border-cyan-700/50',
  },
};

export type InsightCategory =
  | 'goal'
  | 'assumption'
  | 'option'
  | 'decision'
  | 'action'
  | 'uncertainty';

export type InsightStatus = 'accepted' | 'rejected' | 'under_review';

export interface Insight {
  id: string;
  sessionId: string;
  category: InsightCategory;
  title: string;
  content: string;
  status: InsightStatus;
  metadata?: {
    isFact?: boolean; // For assumptions: fact vs assumption
    tradeoffs?: string[]; // For options
    risks?: string[]; // For options
    milestone?: string; // For actions
    confidence?: number;
    userNotes?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode: ThinkingMode;
  suggestedQuestions?: string[];
  suggestedMode?: ThinkingMode;
  extractedInsights?: Partial<Insight>[];
  createdAt: string;
}

export type SessionStatus = 'active' | 'archived' | 'completed';

export interface ThinkingSession {
  id: string;
  userId: string;
  title: string;
  problemStatement: string;
  currentMode: ThinkingMode;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  insights?: Insight[];
  messages?: SessionMessage[];
}

export interface WorkflowTransition {
  id: string;
  sessionId: string;
  fromMode: ThinkingMode;
  toMode: ThinkingMode;
  reason?: string;
  timestamp: string;
}

export interface SessionSummary {
  problem: string;
  clarifiedGoal: string;
  optionsConsidered: {
    title: string;
    description: string;
    tradeoffs: string[];
    risks: string[];
    accepted: boolean;
  }[];
  selectedDirection: string;
  keyAssumptions: {
    statement: string;
    isFact: boolean;
  }[];
  criticalUncertainties: string[];
  actionPlan: {
    step: string;
    milestone?: string;
    priority?: 'high' | 'medium' | 'low';
  }[];
}
