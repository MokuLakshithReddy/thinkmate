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

  // Active sessions: prefers authoritative cloud sessions over local drafts
  const availableSessions = isAuthenticated && cloudSessions.length > 0 ? cloudSessions : localDraftSessions;

  // Active messages derived from cloud sessions, local drafts, or default welcome
  const messages: ChatMessage[] = React.useMemo(() => {
    if (customMessages) return customMessages;
    if (availableSessions.length > 0) {
      const latest = availableSessions[0];
      const resumeOptionId = `resume_${latest.id}`;
      const isCloud = isAuthenticated && cloudSessions.length > 0;
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
  }, [customMessages, availableSessions, isAuthenticated, cloudSessions.length]);

  const currentOptions: ChoiceOption[] | undefined =
    customOptions !== undefined ? customOptions : messages[messages.length - 1]?.options;

  // Authoritative Session ID state and ref (stores real database UUID for cloud sessions)
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const currentSessionIdRef = useRef<string>('');

  const updateSessionId = (id: string) => {
    currentSessionIdRef.current = id;
    setActiveSessionId(id);
  };

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

      if (authToken) {
        try {
          const detailRes = await fetch(`/api/sessions?id=${targetSessionId}`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const session = detailData.session;
            if (session) {
              updateSessionId(session.id);
              setProblemStatement(session.problemStatement || '');

              if (Array.isArray(session.messages) && session.messages.length > 0) {
                const loadedChat: ChatMessage[] = session.messages.map((m: { id: string; role: 'user' | 'assistant'; content: string; mode?: string; createdAt?: string; suggestedQuestions?: string[] }) => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  step: m.mode ? WorkflowStateMachine.deriveCurrentStage(m.mode as 'understand' | 'explore' | 'challenge' | 'decide' | 'act', 0) : 'describe_problem',
                  timestamp: m.createdAt || new Date().toISOString(),
                  options: m.suggestedQuestions?.map((q: string, i: number) => ({ id: `opt_${i}`, label: q })),
                }));
                setCustomMessages(loadedChat);
              }

              const resumedStage = WorkflowStateMachine.deriveCurrentStage(session.currentMode, session.messages?.length || 0);
              setCurrentStep(resumedStage);
            }
          }
        } catch (fetchErr) {
          console.warn('Failed to load session details from server:', fetchErr);
        }
      } else {
        const localMatch = localDraftSessions.find((s) => s.id === targetSessionId);
        if (localMatch) {
          updateSessionId(localMatch.id);
          setProblemStatement(localMatch.problemStatement || '');
        }
      }
    }

    // P0: For authenticated users, ensure an authentic database session exists before calling /api/cothink
    if (authToken && (!currentSessionIdRef.current || !currentSessionIdRef.current.includes('-'))) {
      try {
        const activeProblem = currentStep === 'describe_problem' ? text : (problemStatement || text);
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
          }),
        });

        if (createRes.ok) {
          const createData = await createRes.json();
          if (createData.session?.id) {
            updateSessionId(createData.session.id);
            refreshCloudSessions();
          }
        }
      } catch (err) {
        console.warn('Failed to pre-create session in database:', err);
      }
    } else if (!authToken && !currentSessionIdRef.current) {
      updateSessionId(`demo-${Date.now()}`);
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
      const endpoint = authToken ? '/api/cothink' : '/api/demo/cothink';
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

      // If authenticated call fails with 401, fall back gracefully to demo endpoint
      if (res.status === 401 && endpoint !== '/api/demo/cothink') {
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

      // If in unauthenticated offline mode, save local draft
      if (!authToken) {
        const activeProblem = currentStep === 'describe_problem' ? text : problemStatement;
        const title =
          activeProblem.length > 0
            ? activeProblem.slice(0, 48) + (activeProblem.length > 48 ? '...' : '')
            : 'Offline Demo Session';

        const existingSessions = getStoredSessions();
        const sessionIndex = existingSessions.findIndex((s) => s.id === currentSessionIdRef.current);
        const updatedSession: ThinkingSession = {
          id: currentSessionIdRef.current,
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

        appendStoredMessage(currentSessionIdRef.current, {
          id: userMsg.id,
          sessionId: currentSessionIdRef.current,
          role: 'user',
          content: userMsg.content,
          mode: WorkflowStateMachine.getModeForStage(currentStep),
          createdAt: userMsg.timestamp,
        });

        appendStoredMessage(currentSessionIdRef.current, {
          id: assistantMsg.id,
          sessionId: currentSessionIdRef.current,
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
    updateSessionId('');
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
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      alert('ThinkMate session link copied to clipboard!');
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
            userName={isAuthenticated ? 'Cloud Thinker' : 'Guest Thinker'}
            activeSessionId={activeSessionId}
          />
        </section>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onClearAllData={() => {
          clearAllLocalData();
          handleRestart();
        }}
      />
    </div>
  );
}
