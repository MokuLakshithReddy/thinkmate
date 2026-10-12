'use client';

import React, { useState, useRef, useSyncExternalStore, useEffect, useCallback } from 'react';
import { CoThinkerStep, ChatMessage, ChoiceOption, ThinkingSession } from '@/types';
import { TopNav } from '@/components/cothinker/TopNav';
import { WorkflowCanvas } from '@/components/cothinker/WorkflowCanvas';
import { PreviewPanel } from '@/components/cothinker/PreviewPanel';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { WorkflowStateMachine } from '@/services/workflow/state-machine';
import {
  getStoredSessions,
  saveStoredSessions,
  getStoredMessages,
  appendStoredMessage,
  clearAllLocalData,
} from '@/lib/storage';

interface HistorySnapshot {
  step: CoThinkerStep;
  progressPercent: number;
  messages: ChatMessage[];
  options?: ChoiceOption[];
  problemStatement: string;
  clarifiedObjective: string;
}

const DEFAULT_NEUTRAL_WELCOME: ChatMessage = {
  id: 'msg-init-neutral',
  role: 'assistant',
  step: 'welcome',
  timestamp: '2026-10-12T00:00:00.000Z',
  content: `Welcome to ThinkMate, your personal AI thinking partner.

I help you think through complex problems by clarifying objectives, breaking down tensions, exploring perspectives, and challenging assumptions.

What problem, decision, or dilemma would you like to explore today?`,
  options: [{ id: 'start_new', label: 'Describe a new problem' }],
  executionMode: 'simulator',
  simulatedNotice: 'Session kickoff. Ready to explore your dilemma.',
};

function subscribeToStorage(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getStoredSessionsSnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  return localStorage.getItem('thinkmate_sessions_v1') || '[]';
}

function getServerSessionsSnapshot(): string {
  return '[]';
}

export default function Home() {
  const [viewMode, setViewMode] = useState<'editor' | 'app'>('editor');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Cloud Sessions State (Authoritative source of truth for authenticated users)
  const [cloudSessions, setCloudSessions] = useState<ThinkingSession[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  // Read stored offline sessions via useSyncExternalStore
  const storedSessionsJson = useSyncExternalStore(
    subscribeToStorage,
    getStoredSessionsSnapshot,
    getServerSessionsSnapshot
  );

  const localDraftSessions: ThinkingSession[] = React.useMemo(() => {
    try {
      return JSON.parse(storedSessionsJson);
    } catch {
      return [];
    }
  }, [storedSessionsJson]);

  const [refreshCloudTrigger, setRefreshCloudTrigger] = useState(0);
  const refreshCloudSessions = useCallback(() => {
    setRefreshCloudTrigger((prev) => prev + 1);
  }, []);

  // Synchronize authoritative cloud sessions from Supabase
  useEffect(() => {
    let ignore = false;
    const token = typeof window !== 'undefined' ? localStorage.getItem('thinkmate_auth_token') : null;
    if (!token) return;

    fetch('/api/sessions', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (ignore) return;
        if (res.ok) {
          return res.json().then((data) => {
            if (!ignore) {
              setIsAuthenticated(true);
              if (Array.isArray(data.sessions)) {
                setCloudSessions(data.sessions);
              }
            }
          });
        } else if (res.status === 401) {
          setIsAuthenticated(false);
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch cloud sessions from server:', err);
      });

    return () => {
      ignore = true;
    };
  }, [isSettingsOpen, refreshCloudTrigger]);

  // Workflow State
  const [currentStep, setCurrentStep] = useState<CoThinkerStep>('welcome');
  const [progressPercent, setProgressPercent] = useState(10);
  const [problemStatement, setProblemStatement] = useState<string>('');
  const [clarifiedObjective, setClarifiedObjective] = useState<string>('');
  const [customMessages, setCustomMessages] = useState<ChatMessage[] | null>(null);
  const [customOptions, setCustomOptions] = useState<ChoiceOption[] | undefined>(undefined);

  // Active sessions: Authenticated users only see cloud sessions. Local drafts remain segregated for offline guests.
  const availableSessions = isAuthenticated ? cloudSessions : localDraftSessions;

  // Active messages derived from cloud sessions, local drafts, or default welcome
  const messages: ChatMessage[] = React.useMemo(() => {
    if (customMessages) return customMessages;
    if (availableSessions.length > 0) {
      const latest = availableSessions[0];
      const resumeOptionId = `resume_${latest.id}`;
      const isCloud = isAuthenticated;
      return [
        {
          id: 'msg-init-saved',
          role: 'assistant',
          step: 'welcome',
          timestamp: '2026-10-12T00:00:00.000Z',
          content: `Welcome back to ThinkMate.\n\nI found ${availableSessions.length} ${isCloud ? 'cloud-synced' : 'saved'} session(s) in your account:\n\n${availableSessions
            .slice(0, 3)
            .map((s, idx) => `${idx + 1}. **${s.title}** (*${s.currentMode} mode*)`)
            .join('\n')}\n\nWould you like to resume **${latest.title}** or start a new problem?`,
          options: [
            {
              id: resumeOptionId,
              label: `Resume "${latest.title.length > 40 ? latest.title.slice(0, 38) + '...' : latest.title}"`,
            },
            { id: 'start_new', label: 'Start a new problem' },
          ],
          executionMode: isCloud ? 'gemini' : 'simulator',
          simulatedNotice: isCloud
            ? 'Authoritative session history loaded from Supabase PostgreSQL.'
            : 'Offline draft session history loaded from browser storage.',
        },
      ];
    }
    return [DEFAULT_NEUTRAL_WELCOME];
  }, [customMessages, availableSessions, isAuthenticated]);

  const currentOptions: ChoiceOption[] | undefined =
    customOptions !== undefined ? customOptions : messages[messages.length - 1]?.options;

  // Authoritative Session ID state and ref
  // Explicit session kind tracking ('cloud' for verified DB sessions, 'local' for unauthenticated drafts)
  const isCloudUuid = (id: string | null | undefined): boolean =>
    typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [sessionKind, setSessionKind] = useState<'cloud' | 'local' | null>(null);
  const currentSessionIdRef = useRef<string>('');
  const sessionKindRef = useRef<'cloud' | 'local' | null>(null);

  const updateSessionState = (id: string, kind: 'cloud' | 'local' | null) => {
    currentSessionIdRef.current = id;
    sessionKindRef.current = kind;
    setActiveSessionId(id);
    setSessionKind(kind);
  };

  // Load session records by ID (supports cloud database and offline drafts)
  const loadSessionById = useCallback(
    async (targetSessionId: string) => {
      const authToken = typeof window !== 'undefined' ? localStorage.getItem('thinkmate_auth_token') : null;
      if (authToken && isCloudUuid(targetSessionId)) {
        try {
          const detailRes = await fetch(`/api/sessions?id=${targetSessionId}`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const session = detailData.session;
            if (session) {
              updateSessionState(session.id, 'cloud');
              setProblemStatement(session.problemStatement || '');

              if (Array.isArray(session.messages) && session.messages.length > 0) {
                const loadedChat: ChatMessage[] = session.messages.map(
                  (m: { id: string; role: 'user' | 'assistant'; content: string; mode?: string; createdAt?: string; suggestedQuestions?: string[] }) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    step: m.mode
                      ? WorkflowStateMachine.deriveCurrentStage(m.mode as 'understand' | 'explore' | 'challenge' | 'decide' | 'act', 0)
                      : 'describe_problem',
                    timestamp: m.createdAt || new Date().toISOString(),
                    options: m.suggestedQuestions?.map((q: string, i: number) => ({ id: `opt_${i}`, label: q })),
                  })
                );
                setCustomMessages(loadedChat);
              }

              const resumedStage =
                session.currentStage ||
                WorkflowStateMachine.deriveCurrentStage(session.currentMode, session.messages?.length || 0);
              setCurrentStep(resumedStage);
              return true;
            }
          }
        } catch (fetchErr) {
          console.warn('Failed to load session details from server:', fetchErr);
        }
      }

      // Check local drafts
      const localMatch = localDraftSessions.find((s) => s.id === targetSessionId);
      if (localMatch) {
        updateSessionState(localMatch.id, 'local');
        setProblemStatement(localMatch.problemStatement || '');
        const localMessages = getStoredMessages(localMatch.id);
        if (localMessages.length > 0) {
          const loadedChat: ChatMessage[] = localMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            step: m.mode
              ? WorkflowStateMachine.deriveCurrentStage(m.mode as 'understand' | 'explore' | 'challenge' | 'decide' | 'act', 0)
              : 'describe_problem',
            timestamp: m.createdAt,
            options: m.suggestedQuestions?.map((q: string, i: number) => ({ id: `opt_${i}`, label: q })),
          }));
          setCustomMessages(loadedChat);
        }
        return true;
      }
      return false;
    },
    [localDraftSessions]
  );

  // Resume session from URL search query parameter ?session=UUID
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    if (sessionParam) {
      const timer = setTimeout(() => {
        loadSessionById(sessionParam);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [loadSessionById]);

  // Undo / Redo stacks
  const [pastSnapshots, setPastSnapshots] = useState<HistorySnapshot[]>([]);
  const [futureSnapshots, setFutureSnapshots] = useState<HistorySnapshot[]>([]);

  const takeSnapshot = (): HistorySnapshot => ({
    step: currentStep,
    progressPercent,
    messages,
    options: currentOptions,
    problemStatement,
    clarifiedObjective,
  });

  const handleUndo = () => {
    if (pastSnapshots.length === 0) return;
    const previous = pastSnapshots[pastSnapshots.length - 1];
    const newPast = pastSnapshots.slice(0, pastSnapshots.length - 1);
    const current = takeSnapshot();

    setFutureSnapshots((prev) => [current, ...prev]);
    setPastSnapshots(newPast);

    setCurrentStep(previous.step);
    setProgressPercent(previous.progressPercent);
    setCustomMessages(previous.messages);
    setCustomOptions(previous.options);
    setProblemStatement(previous.problemStatement);
    setClarifiedObjective(previous.clarifiedObjective);
  };

  const handleRedo = () => {
    if (futureSnapshots.length === 0) return;
    const next = futureSnapshots[0];
    const newFuture = futureSnapshots.slice(1);
    const current = takeSnapshot();

    setPastSnapshots((prev) => [...prev, current]);
    setFutureSnapshots(newFuture);

    setCurrentStep(next.step);
    setProgressPercent(next.progressPercent);
    setCustomMessages(next.messages);
    setCustomOptions(next.options);
    setProblemStatement(next.problemStatement);
    setClarifiedObjective(next.clarifiedObjective);
  };

  const handleSendMessage = async (text: string, selectedOptionId?: string) => {
    const authToken = typeof window !== 'undefined' ? localStorage.getItem('thinkmate_auth_token') : null;

    // Record current state into undo stack
    setPastSnapshots((prev) => [...prev, takeSnapshot()]);
    setFutureSnapshots([]); // Clear redo stack on new action

    // If user clicked resume on an existing session, load authoritative records
    if (selectedOptionId?.startsWith('resume_')) {
      const targetSessionId = selectedOptionId.replace('resume_', '');
      await loadSessionById(targetSessionId);
    }

    // Special kickoff handling: clicking "Start a new problem" transitions from welcome to describe_problem
    if (currentStep === 'welcome' && selectedOptionId === 'start_new') {
      const userKickoffMsg: ChatMessage = {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: text || 'Start a new problem',
        step: 'welcome',
        timestamp: new Date().toISOString(),
        selectedOptionId,
      };
      const assistantIntroMsg: ChatMessage = {
        id: `msg-ast-${Date.now()}`,
        role: 'assistant',
        content: "What is the core dilemma or problem you are trying to understand and solve? Describe the situation, tension, or challenge you're facing.",
        step: 'describe_problem',
        timestamp: new Date().toISOString(),
        executionMode: authToken ? 'gemini' : 'simulator',
      };
      setCurrentStep('describe_problem');
      setProgressPercent(20);
      setProblemStatement('');
      setClarifiedObjective('');
      setCustomMessages([userKickoffMsg, assistantIntroMsg]);
      return;
    }

    // P0/P1: For authenticated users, create an authentic database session once problem description is provided
    if (authToken && sessionKindRef.current !== 'cloud' && (currentStep === 'describe_problem' || (!currentSessionIdRef.current && text.trim().length > 0))) {
      try {
        const activeProblem = text.trim();
        const title =
          activeProblem.length > 0
            ? activeProblem.slice(0, 48) + (activeProblem.length > 48 ? '...' : '')
            : 'New Thinking Session';

        const createRes = await fetch('/api/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            title,
            problemStatement: activeProblem,
            currentMode: 'understand',
            currentStage: 'describe_problem',
          }),
        });

        if (createRes.ok) {
          const createData = await createRes.json();
          if (createData.session?.id && isCloudUuid(createData.session.id)) {
            updateSessionState(createData.session.id, 'cloud');
            refreshCloudSessions();
          }
        } else {
          console.warn('Cloud session creation returned status', createRes.status);
          if (createRes.status === 401) {
            setIsAuthenticated(false);
            localStorage.removeItem('thinkmate_auth_token');
          }
          updateSessionState(`local-${Date.now()}`, 'local');
        }
      } catch (err) {
        console.warn('Failed to pre-create session in database:', err);
        updateSessionState(`local-${Date.now()}`, 'local');
      }
    } else if (!authToken && !currentSessionIdRef.current) {
      updateSessionState(`demo-${Date.now()}`, 'local');
    }

    const userMsg: ChatMessage = {
      id: `msg-user-${Date.now()}`,
      role: 'user',
      content: text,
      step: currentStep,
      timestamp: new Date().toISOString(),
      selectedOptionId,
    };

    const nextHistory = [...messages, userMsg];
    setCustomMessages(nextHistory);
    setIsLoading(true);

    if (currentStep === 'describe_problem') {
      setProblemStatement(text);
    }

    try {
      const isCloud = Boolean(authToken && sessionKindRef.current === 'cloud' && isCloudUuid(currentSessionIdRef.current));
      const endpoint = isCloud ? '/api/cothink' : '/api/demo/cothink';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      let res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sessionId: currentSessionIdRef.current,
          step: currentStep,
          userMessage: text,
          selectedOptionId,
          problemStatement: currentStep === 'describe_problem' ? text : problemStatement,
          clarifiedObjective,
        }),
      });

      // If authenticated call fails with 401, fall back gracefully to demo simulator and convert to local draft
      if (res.status === 401 && endpoint !== '/api/demo/cothink') {
        setIsAuthenticated(false);
        localStorage.removeItem('thinkmate_auth_token');
        updateSessionState(`draft-${Date.now()}`, 'local');

        res = await fetch('/api/demo/cothink', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step: currentStep,
            userMessage: text,
            selectedOptionId,
            problemStatement: currentStep === 'describe_problem' ? text : problemStatement,
            clarifiedObjective,
            history: nextHistory.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Co-think API failed with status ${res.status}`);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: `msg-ast-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        step: data.nextStep,
        options: data.options,
        timestamp: new Date().toISOString(),
        executionMode: data.executionMode,
        modelName: data.modelName,
        simulatedNotice: data.simulatedNotice,
      };

      setCustomMessages([...nextHistory, assistantMsg]);
      setCurrentStep(data.nextStep);
      setCustomOptions(data.options);
      setProgressPercent(data.progressPercent || 50);

      if (data.nextStep === 'break_subproblems' && !clarifiedObjective) {
        setClarifiedObjective(text);
      }

      // If session is NOT cloud-persisted (offline guest, or degraded/fallen-back draft),
      // persist it into localStorage immediately so no conversation is ever lost
      if (sessionKindRef.current !== 'cloud') {
        const activeProblem = currentStep === 'describe_problem' ? text : problemStatement;
        const title =
          activeProblem.length > 0
            ? activeProblem.slice(0, 48) + (activeProblem.length > 48 ? '...' : '')
            : 'Local Draft Session';

        const localId = currentSessionIdRef.current || `local-${Date.now()}`;
        if (!currentSessionIdRef.current) {
          updateSessionState(localId, 'local');
        }

        const existingSessions = getStoredSessions();
        const sessionIndex = existingSessions.findIndex((s) => s.id === localId);
        const updatedSession: ThinkingSession = {
          id: localId,
          userId: 'demo-local',
          title,
          problemStatement: activeProblem,
          currentMode: WorkflowStateMachine.getModeForStage(data.nextStep),
          status: 'active',
          createdAt:
            sessionIndex >= 0 ? existingSessions[sessionIndex].createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (sessionIndex >= 0) {
          existingSessions[sessionIndex] = updatedSession;
        } else {
          existingSessions.unshift(updatedSession);
        }
        saveStoredSessions(existingSessions);

        appendStoredMessage(localId, {
          id: userMsg.id,
          sessionId: localId,
          role: 'user',
          content: userMsg.content,
          mode: WorkflowStateMachine.getModeForStage(currentStep),
          createdAt: userMsg.timestamp,
        });

        appendStoredMessage(localId, {
          id: assistantMsg.id,
          sessionId: localId,
          role: 'assistant',
          content: assistantMsg.content,
          mode: WorkflowStateMachine.getModeForStage(data.nextStep),
          createdAt: assistantMsg.timestamp,
        });
      } else {
        // Authenticated mode: refresh cloud sessions list to reflect updated timestamps
        refreshCloudSessions();
      }
    } catch (err: unknown) {
      console.error('Co-think communication error:', err);
      const errMsg = (err as Error)?.message || 'Network or API error occurred.';
      const fallbackMsg: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        role: 'assistant',
        content: `I encountered an issue processing this workflow stage: **${errMsg}**\n\nYour input ("${text}") has been retained. Please retry or check your connection.`,
        step: currentStep,
        timestamp: new Date().toISOString(),
        executionMode: 'error',
        simulatedNotice: errMsg,
      };
      setCustomMessages([...nextHistory, fallbackMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = () => {
    updateSessionState('', null);
    setCurrentStep('welcome');
    setProgressPercent(10);
    setProblemStatement('');
    setClarifiedObjective('');
    setCustomMessages(null);
    setCustomOptions(undefined);
    setPastSnapshots([]);
    setFutureSnapshots([]);
  };

  const handleShare = () => {
    if (typeof window === 'undefined' || !navigator.clipboard) return;
    if (activeSessionId) {
      const shareUrl = `${window.location.origin}/?session=${encodeURIComponent(activeSessionId)}`;
      navigator.clipboard.writeText(shareUrl);
      alert(`ThinkMate session link copied to clipboard:\n${shareUrl}`);
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert('ThinkMate application link copied to clipboard!');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans antialiased">
      {/* Top Header */}
      <TopNav
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onShare={handleShare}
        userName={isAuthenticated ? 'Cloud User' : 'Guest Thinker'}
      />

      {/* Main Dual-Pane Workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Pane: Flowchart Canvas */}
        <section
          className={
            viewMode === 'editor'
              ? 'flex-1 lg:flex-[1.1] border-r border-slate-800 flex flex-col h-full bg-[#0d1321] transition-all'
              : 'hidden lg:flex lg:flex-[1.1] border-r border-slate-800 flex-col h-full bg-[#0d1321]'
          }
        >
          <WorkflowCanvas
            currentStep={currentStep}
            isLoading={isLoading}
            canUndo={pastSnapshots.length > 0}
            canRedo={futureSnapshots.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />
        </section>

        {/* Right Pane: Interactive Chat Preview Panel */}
        <section
          className={
            viewMode === 'app'
              ? 'flex-1 flex flex-col h-full bg-[#0b0f19] transition-all'
              : 'hidden lg:flex flex-1 flex-col h-full bg-[#0b0f19]'
          }
        >
          <PreviewPanel
            currentStep={currentStep}
            progressPercent={progressPercent}
            messages={messages}
            currentOptions={currentOptions}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onRestart={handleRestart}
            userName={isAuthenticated && sessionKind === 'cloud' ? 'Cloud Thinker' : 'Guest Thinker'}
            activeSessionId={activeSessionId}
          />
        </section>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onClearAllData={async (options) => {
          if (options?.wipeCloud) {
            clearAllLocalData(true);
            setIsAuthenticated(false);
            setCloudSessions([]);
          } else {
            clearAllLocalData(false);
          }
          handleRestart();
        }}
      />
    </div>
  );
}
