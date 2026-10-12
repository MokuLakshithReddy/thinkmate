import { ThinkingSession, SessionMessage, Insight } from '@/types';

const SESSIONS_KEY = 'thinkmate_sessions_v1';
const MESSAGES_KEY = 'thinkmate_messages_v1';
const INSIGHTS_KEY = 'thinkmate_insights_v1';

export function getStoredSessions(): ThinkingSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveStoredSessions(sessions: ThinkingSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function getStoredMessages(sessionId: string): SessionMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map[sessionId] || [];
  } catch {
    return [];
  }
}

export function saveStoredMessages(map: Record<string, SessionMessage[]>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(map));
}

export function appendStoredMessage(sessionId: string, message: SessionMessage): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[sessionId] = [...(map[sessionId] || []), message];
    saveStoredMessages(map);
  } catch (err) {
    console.error('Failed to append message', err);
  }
}

export function getStoredInsights(sessionId: string): Insight[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(INSIGHTS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map[sessionId] || [];
  } catch {
    return [];
  }
}

export function saveStoredInsights(map: Record<string, Insight[]>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(INSIGHTS_KEY, JSON.stringify(map));
}

export function updateStoredInsight(sessionId: string, insight: Insight): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(INSIGHTS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const existing = map[sessionId] || [];
    const index = existing.findIndex((i: Insight) => i.id === insight.id);
    if (index >= 0) {
      existing[index] = insight;
    } else {
      existing.push(insight);
    }
    map[sessionId] = existing;
    saveStoredInsights(map);
  } catch (err) {
    console.error('Failed to update insight', err);
  }
}

export function deleteStoredSessionData(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const sessions = getStoredSessions().filter((s) => s.id !== sessionId);
    saveStoredSessions(sessions);

    const rawMsgs = localStorage.getItem(MESSAGES_KEY);
    if (rawMsgs) {
      const map = JSON.parse(rawMsgs);
      delete map[sessionId];
      saveStoredMessages(map);
    }

    const rawIns = localStorage.getItem(INSIGHTS_KEY);
    if (rawIns) {
      const map = JSON.parse(rawIns);
      delete map[sessionId];
      saveStoredInsights(map);
    }
  } catch (err) {
    console.error('Failed to delete session', err);
  }
}

export function clearAllLocalData(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSIONS_KEY);
  localStorage.removeItem(MESSAGES_KEY);
  localStorage.removeItem(INSIGHTS_KEY);
  localStorage.removeItem('thinkmate_gemini_key');
  localStorage.removeItem('thinkmate_model');
}

export function createInitialDemoSession(): {
  session: ThinkingSession;
  messages: SessionMessage[];
  insights: Insight[];
} {
  const sessionId = 'session-demo-01';
  const now = new Date().toISOString();

  const session: ThinkingSession = {
    id: sessionId,
    userId: 'local-user',
    title: 'Migrate Monolith to Serverless Microservices?',
    problemStatement:
      'Our team is experiencing deployment bottlenecks with our monolithic API. Some want to rewrite into granular AWS Lambda functions, while others argue containerizing into ECS will solve deployment without distributed tracing overhead.',
    currentMode: 'understand',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const messages: SessionMessage[] = [
    {
      id: 'msg-demo-1',
      sessionId,
      role: 'user',
      content:
        'We have a 6-year-old Node monolith. Deploys take 25 minutes and test flakiness is high. Half the team wants Lambdas, half wants ECS containers. Which should we pick?',
      mode: 'understand',
      createdAt: now,
    },
    {
      id: 'msg-demo-2',
      sessionId,
      role: 'assistant',
      content:
        "Before jumping to architecture selection, let's step back into **Understand Mode** and clarify the true constraint.\n\nNotice that the friction you described has two distinct symptoms:\n1. **Deployment latency** (25-minute build/deploy cycle).\n2. **Test flakiness & CI friction** (monolithic test suite coupling).\n\nSplitting into Lambdas does not automatically fix test flakiness; in fact, distributed serverless architectures often make local end-to-end testing significantly harder. Let's isolate what outcome matters most right now.",
      mode: 'understand',
      suggestedQuestions: [
        'What specific part of the 25-minute deploy pipeline is the primary bottleneck?',
        'Are teams blocked by shared database migrations or by code deployments?',
        'What is our tolerance for operational complexity and cold starts?',
      ],
      createdAt: now,
    },
  ];

  const insights: Insight[] = [
    {
      id: 'ins-1',
      sessionId,
      category: 'goal',
      title: 'Decouple Deployment Velocity',
      content: 'Cut deploy cycle times from 25m to under 5m while preventing shared test suite flakiness.',
      status: 'accepted',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ins-2',
      sessionId,
      category: 'assumption',
      title: 'Serverless Eliminates CI Bottlenecks',
      content: 'Assumption: Migrating to Lambdas will speed up testing. Status: Unproven hypothesis.',
      status: 'under_review',
      metadata: {
        isFact: false,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ins-3',
      sessionId,
      category: 'option',
      title: 'Modular Monolith with Fast CI Cache',
      content: 'Keep single deployment unit, split internal domain packages with Turborepo, parallelize test matrix.',
      status: 'under_review',
      metadata: {
        tradeoffs: ['Requires disciplined code boundary enforcement', 'Shared database remains'],
        risks: ['Discipline erosion over time without lint enforcement'],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ins-4',
      sessionId,
      category: 'option',
      title: 'Containerized ECS Microservices',
      content: 'Carve out the 2 highest-frequency services into containerized microservices behind an API gateway.',
      status: 'accepted',
      metadata: {
        tradeoffs: ['Requires service-to-service auth', 'Increases infra footprint'],
        risks: ['Distributed transactions and data sync latency'],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ins-5',
      sessionId,
      category: 'decision',
      title: 'Iterative Modularization over Full Lambda Rewrite',
      content: 'Focus first on CI test sharding and boundary enforcement before spinning off external network calls.',
      status: 'accepted',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ins-6',
      sessionId,
      category: 'action',
      title: 'Profile CI Pipeline Stages',
      content: 'Instrument test suite runtimes and docker build steps to pinpoint the 25-minute delay.',
      status: 'under_review',
      metadata: {
        milestone: 'Week 1',
      },
      createdAt: now,
      updatedAt: now,
    },
  ];

  return { session, messages, insights };
}
