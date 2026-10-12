'use client';

import React, { useState, useRef, useSyncExternalStore } from 'react';
import { CoThinkerStep, ChatMessage, ChoiceOption, ThinkingSession } from '@/types';
import { TopNav } from '@/components/cothinker/TopNav';
import { WorkflowCanvas } from '@/components/cothinker/WorkflowCanvas';
import { PreviewPanel } from '@/components/cothinker/PreviewPanel';
import { SettingsModal } from '@/components/modals/SettingsModal';
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

  // Read stored sessions via useSyncExternalStore (React 19 / Next 16 compliant)
  const storedSessionsJson = useSyncExternalStore(
    subscribeToStorage,
    getStoredSessionsSnapshot,
    getServerSessionsSnapshot
  );

  const persistedSessions: ThinkingSession[] = React.useMemo(() => {
    try {
      return JSON.parse(storedSessionsJson);
    } catch {
      return [];
    }
  }, [storedSessionsJson]);

  // Workflow State
  const [currentStep, setCurrentStep] = useState<CoThinkerStep>('welcome');
  const [progressPercent, setProgressPercent] = useState(10);
  const [problemStatement, setProblemStatement] = useState<string>('');
  const [clarifiedObjective, setClarifiedObjective] = useState<string>('');
  const [customMessages, setCustomMessages] = useState<ChatMessage[] | null>(null);
  const [customOptions, setCustomOptions] = useState<ChoiceOption[] | undefined>(undefined);

  // Active messages derived from persisted sessions or active thread
  const messages: ChatMessage[] = React.useMemo(() => {
    if (customMessages) return customMessages;
    if (persistedSessions.length > 0) {
      const latest = persistedSessions[0];
      const resumeOptionId = `resume_${latest.id}`;
      return [
        {
          id: 'msg-init-saved',
          role: 'assistant',
          step: 'welcome',
          timestamp: '2026-10-12T00:00:00.000Z',
          content: `Welcome back to ThinkMate.\n\nI found ${persistedSessions.length} saved session(s) in your local memory:\n\n${persistedSessions
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
          executionMode: 'simulator',
          simulatedNotice: 'Verified session history retrieved from local storage.',
        },
      ];
    }
    return [DEFAULT_NEUTRAL_WELCOME];
  }, [customMessages, persistedSessions]);

  const currentOptions: ChoiceOption[] | undefined =
    customOptions !== undefined ? customOptions : messages[messages.length - 1]?.options;

  // Session tracking ref (purely assigned in event handlers)
  const currentSessionIdRef = useRef<string>('');

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
    if (!currentSessionIdRef.current) {
      currentSessionIdRef.current = `session-${Date.now()}`;
    }

    // Record current state into undo stack
    setPastSnapshots((prev) => [...prev, takeSnapshot()]);
    setFutureSnapshots([]); // Clear redo stack on new action

    // If user clicked resume on a verified session, load its title
    let activeSessionTitle: string | undefined;
    if (selectedOptionId?.startsWith('resume_')) {
      const targetSessionId = selectedOptionId.replace('resume_', '');
      const sessions = getStoredSessions();
      const match = sessions.find((s) => s.id === targetSessionId);
      if (match) {
        currentSessionIdRef.current = match.id;
        activeSessionTitle = match.title;
        setProblemStatement(match.problemStatement || '');
      }
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
      const res = await fetch('/api/cothink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: currentStep,
          userMessage: text,
          selectedOptionId,
          problemStatement: currentStep === 'describe_problem' ? text : problemStatement,
          clarifiedObjective,
          activeSessionTitle,
          history: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Co-think API failed with status ${res.status}`);
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

      // Persist session into storage
      const activeProblem = currentStep === 'describe_problem' ? text : problemStatement;
      const title =
        activeProblem.length > 0
          ? activeProblem.slice(0, 48) + (activeProblem.length > 48 ? '...' : '')
          : 'Active Thinking Session';

      const existingSessions = getStoredSessions();
      const sessionIndex = existingSessions.findIndex((s) => s.id === currentSessionIdRef.current);
      const updatedSession: ThinkingSession = {
        id: currentSessionIdRef.current,
        userId: 'local-user',
        title,
        problemStatement: activeProblem,
        currentMode: 'understand',
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
        mode: 'understand',
        createdAt: userMsg.timestamp,
      });

      appendStoredMessage(currentSessionIdRef.current, {
        id: assistantMsg.id,
        sessionId: currentSessionIdRef.current,
        role: 'assistant',
        content: assistantMsg.content,
        mode: 'understand',
        createdAt: assistantMsg.timestamp,
      });
    } catch (err) {
      console.error('Co-think communication error:', err);
      const fallbackMsg: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        role: 'assistant',
        content: `I encountered an issue connecting to the thinking service. Your input ("${text}") has been retained. Please retry or verify your network.`,
        step: currentStep,
        timestamp: new Date().toISOString(),
        executionMode: 'error',
        simulatedNotice: 'Network or API error occurred. Live reasoning could not be completed.',
      };
      setCustomMessages([...nextHistory, fallbackMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = () => {
    setPastSnapshots((prev) => [...prev, takeSnapshot()]);
    setFutureSnapshots([]);
    currentSessionIdRef.current = `session-${Date.now()}`;
    setCurrentStep('welcome');
    setProgressPercent(10);
    setProblemStatement('');
    setClarifiedObjective('');
    setCustomMessages([DEFAULT_NEUTRAL_WELCOME]);
    setCustomOptions(DEFAULT_NEUTRAL_WELCOME.options);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white text-slate-900 font-sans">
      {/* Top Navigation */}
      <TopNav
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onShare={async () => {
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              await navigator.clipboard.writeText(window.location.href);
              alert('Session link copied to clipboard!');
            } else {
              alert('Clipboard access unavailable.');
            }
          } catch (e) {
            console.warn('Clipboard write error:', e);
          }
        }}
      />

      {/* Main Dual-Pane Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Interactive 8-Stage Flowchart Canvas */}
        {viewMode === 'editor' && (
          <WorkflowCanvas
            currentStep={currentStep}
            isLoading={isLoading}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={pastSnapshots.length > 0}
            canRedo={futureSnapshots.length > 0}
          />
        )}

        {/* Right: Interactive Co-Thinker Chat / Preview Panel */}
        <div className={viewMode === 'app' ? 'flex-1 flex justify-center bg-[#f0f9fb]' : ''}>
          <PreviewPanel
            currentStep={currentStep}
            progressPercent={progressPercent}
            messages={messages}
            currentOptions={currentOptions}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onRestart={handleRestart}
          />
        </div>
      </div>

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
