// ==========================================
// 1. Co-Thinker Flowchart Stages & Types (Images 1 & 2)
// ==========================================

export type CoThinkerStep =
  | 'welcome'
  | 'describe_problem'
  | 'clarify_objective'
  | 'break_subproblems'
  | 'explore_perspectives'
  | 'challenge_assumptions'
  | 'check_satisfaction'
  | 'summarize_insights'
  | 'choose_action';

export interface WorkflowStageInfo {
  step: CoThinkerStep;
  number: number;
  label: string;
  shortDescription: string;
  nodeInstruction: string;
  memoryKey?: string;
}

export const WORKFLOW_STAGES: Record<CoThinkerStep, WorkflowStageInfo> = {
  welcome: {
    step: 'welcome',
    number: 0,
    label: 'Session Kickoff & Memory',
    shortDescription: 'Retrieve past project memory or start a new problem.',
    nodeInstruction: 'Act as a co-thinker: chat with the user to help them better understand the problem they are having. Use Memory to retrieve conversation history.',
    memoryKey: 'Use Memory',
  },
  describe_problem: {
    step: 'describe_problem',
    number: 1,
    label: 'User describes a problem',
    shortDescription: 'Capture the core tension, situation, and dilemma.',
    nodeInstruction: 'Listen attentively to the problem statement without offering quick solutions. Focus on deep understanding.',
  },
  clarify_objective: {
    step: 'clarify_objective',
    number: 2,
    label: 'AI clarifies the objective',
    shortDescription: 'Isolate what success looks like and the true underlying goal.',
    nodeInstruction: 'Probe stated goals vs underlying needs. Ask targeted questions to clarify the exact target outcome.',
  },
  break_subproblems: {
    step: 'break_subproblems',
    number: 3,
    label: 'Break problem into subproblems',
    shortDescription: 'Deconstruct complexity into distinct manageable pillars.',
    nodeInstruction: 'Decompose the user dilemma into 2-4 distinct subproblems or structural tensions.',
  },
  explore_perspectives: {
    step: 'explore_perspectives',
    number: 4,
    label: 'Explore perspectives and evidence',
    shortDescription: 'Analyze multiple angles: technical, user, business, risk, and facts.',
    nodeInstruction: 'Identify distinct perspectives (user experience, technical debt, risk, business impact) and evaluate empirical evidence.',
  },
  challenge_assumptions: {
    step: 'challenge_assumptions',
    number: 5,
    label: 'Challenge assumptions',
    shortDescription: 'Surface unproven beliefs, blind spots, and single points of failure.',
    nodeInstruction: 'Audit what the user takes for granted. Clearly label verified facts vs unproven assumptions.',
  },
  check_satisfaction: {
    step: 'check_satisfaction',
    number: 6,
    label: 'User satisfied with understanding?',
    shortDescription: 'Verify if understanding is complete before synthesizing.',
    nodeInstruction: 'Ask the user if they feel the problem and perspectives are fully understood. If "Not yet", loop back to explore further.',
  },
  summarize_insights: {
    step: 'summarize_insights',
    number: 7,
    label: 'Summarize insights and options',
    shortDescription: 'Deliver structured synthesis: core dilemma, key insights, and options.',
    nodeInstruction: 'Synthesize the clarified objective, verified facts, core assumptions, and viable strategic options.',
  },
  choose_action: {
    step: 'choose_action',
    number: 8,
    label: 'User chooses next action',
    shortDescription: 'Select concrete next step and execution plan.',
    nodeInstruction: 'Present actionable next steps. Guide the user in locking in their immediate priority.',
  },
};

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
}

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  step: CoThinkerStep;
  options?: ChoiceOption[];
  selectedOptionId?: string;
  timestamp: string;
  executionMode?: 'gemini' | 'simulator' | 'error';
  modelName?: string;
  simulatedNotice?: string;
}

export interface PastProjectMemory {
  id: string;
  title: string;
  summary: string;
  lastStep: CoThinkerStep;
}

export interface SessionMemoryState {
  userName: string;
  pastProjects: PastProjectMemory[];
  currentProblem?: string;
  clarifiedObjective?: string;
  subproblems?: string[];
  perspectives?: { title: string; description: string }[];
  assumptions?: { text: string; isFact: boolean }[];
  currentStep: CoThinkerStep;
  progressPercent: number;
}

// ==========================================
// 2. 5 Thinking Modes & Domain Types
// ==========================================

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
    isFact?: boolean;
    tradeoffs?: string[];
    risks?: string[];
    milestone?: string;
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
