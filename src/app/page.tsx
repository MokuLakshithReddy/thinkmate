'use client';

import React, { useState, useEffect } from 'react';
import { ThinkingSession, SessionMessage, Insight, ThinkingMode, InsightStatus } from '@/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { SessionSidebar } from '@/components/layout/SessionSidebar';
import { InsightPanel } from '@/components/layout/InsightPanel';
import { ModeSelector } from '@/components/thinking/ModeSelector';
import { ThinkingWorkspace } from '@/components/thinking/ThinkingWorkspace';
import { HomeDashboard } from '@/components/home/HomeDashboard';
import { NewSessionModal } from '@/components/modals/NewSessionModal';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { DecisionSummaryModal } from '@/components/modals/DecisionSummaryModal';
import { TransitionAlertModal } from '@/components/modals/TransitionAlertModal';
import { WorkflowStateMachine } from '@/services/workflow/state-machine';
import {
  getStoredSessions,
  saveStoredSessions,
  getStoredMessages,
  appendStoredMessage,
  getStoredInsights,
  updateStoredInsight,
  deleteStoredSessionData,
  clearAllLocalData,
} from '@/lib/storage';

export default function Home() {
  const [sessions, setSessions] = useState<ThinkingSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);

  // Layout UI Toggles
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isInsightOpen, setIsInsightOpen] = useState(true);

  // Modals
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [transitionAlert, setTransitionAlert] = useState<{
    isOpen: boolean;
    targetMode: ThinkingMode | null;
    reason: string;
    warning?: string;
    recommendedMode?: ThinkingMode;
  }>({
    isOpen: false,
    targetMode: null,
    reason: '',
  });

  // Hydrate on mount
  useEffect(() => {
    const stored = getStoredSessions();
    setSessions(stored);
    if (stored.length > 0) {
      setActiveSessionId(stored[0].id);
    }
  }, []);

  // Update messages and insights whenever activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setInsights([]);
      setSuggestedQuestions([]);
      return;
    }
    const msgs = getStoredMessages(activeSessionId);
    const ins = getStoredInsights(activeSessionId);
    setMessages(msgs);
    setInsights(ins);

    // Extract suggested questions from last assistant message
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant?.suggestedQuestions) {
      setSuggestedQuestions(lastAssistant.suggestedQuestions);
    } else {
      setSuggestedQuestions([]);
    }
  }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  // Session Handlers
  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
  };

  const handleCreateSession = (title: string, problemStatement: string, initialMode: ThinkingMode) => {
    const newId = `session-${Date.now()}`;
    const now = new Date().toISOString();
    const newSession: ThinkingSession = {
      id: newId,
      userId: 'local-user',
      title,
      problemStatement,
      currentMode: initialMode,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const initialMessage: SessionMessage = {
      id: `msg-${Date.now()}`,
      sessionId: newId,
      role: 'user',
      content: problemStatement,
      mode: initialMode,
      createdAt: now,
    };

    const updatedSessions = [newSession, ...sessions];
    setSessions(updatedSessions);
    saveStoredSessions(updatedSessions);
    appendStoredMessage(newId, initialMessage);

    setActiveSessionId(newId);

    // Trigger AI thinking kickoff for this new problem
    triggerAIThinking(newSession, [initialMessage], initialMode);
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    const updated = sessions.map((s) => (s.id === id ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s));
    setSessions(updated);
    saveStoredSessions(updated);
  };

  const handleArchiveSession = (id: string, archive: boolean) => {
    const updated = sessions.map((s) =>
      s.id === id ? { ...s, status: (archive ? 'archived' : 'active') as 'archived' | 'active', updatedAt: new Date().toISOString() } : s
    );
    setSessions(updated);
    saveStoredSessions(updated);
  };

  const handleDeleteSession = (id: string) => {
    deleteStoredSessionData(id);
    const updated = sessions.filter((s) => s.id !== id);
    setSessions(updated);
    if (activeSessionId === id) {
      setActiveSessionId(updated.length > 0 ? updated[0].id : null);
    }
  };

  const handleSelectMode = (newMode: ThinkingMode, forceOverride = false) => {
    if (!activeSession) return;

    if (!forceOverride) {
      const validation = WorkflowStateMachine.validateTransition(activeSession.currentMode, newMode, {
        insights,
        hasAcceptedDecision: insights.some((i) => i.category === 'decision' && i.status === 'accepted'),
      });

      if (!validation.allowed) {
        setTransitionAlert({
          isOpen: true,
          targetMode: newMode,
          reason: validation.reason || 'Guardrail blocked transition',
          warning: validation.warning,
          recommendedMode: validation.recommendedMode,
        });
        return;
      }
    }

    const updatedSession = { ...activeSession, currentMode: newMode, updatedAt: new Date().toISOString() };
    const updatedSessions = sessions.map((s) => (s.id === activeSession.id ? updatedSession : s));
    setSessions(updatedSessions);
    saveStoredSessions(updatedSessions);
  };

  // Insight Handlers
  const handleUpdateInsightStatus = (id: string, status: InsightStatus, notes?: string) => {
    if (!activeSessionId) return;
    const target = insights.find((i) => i.id === id);
    if (!target) return;

    const updated: Insight = {
      ...target,
      status,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...target.metadata,
        ...(notes ? { userNotes: notes } : {}),
      },
    };

    const nextList = insights.map((i) => (i.id === id ? updated : i));
    setInsights(nextList);
    updateStoredInsight(activeSessionId, updated);
  };

  const handleEditInsight = (id: string, partial: Partial<Insight>) => {
    if (!activeSessionId) return;
    const target = insights.find((i) => i.id === id);
    if (!target) return;

    const updated: Insight = {
      ...target,
      ...partial,
      metadata: {
        ...target.metadata,
        ...partial.metadata,
      },
      updatedAt: new Date().toISOString(),
    };

    const nextList = insights.map((i) => (i.id === id ? updated : i));
    setInsights(nextList);
    updateStoredInsight(activeSessionId, updated);
  };

  const handleDeleteInsight = (id: string) => {
    if (!activeSessionId) return;
    const nextList = insights.filter((i) => i.id !== id);
    setInsights(nextList);
  };

  // AI Streaming trigger (connected to /api/think/stream in Milestone 2)
  const triggerAIThinking = async (
    session: ThinkingSession,
    currentHistory: SessionMessage[],
    mode: ThinkingMode
  ) => {
    setIsStreaming(true);
    setStreamingText('');

    try {
      const apiKey = typeof window !== 'undefined' ? localStorage.getItem('thinkmate_gemini_key') || '' : '';
      const model = typeof window !== 'undefined' ? localStorage.getItem('thinkmate_model') || 'gemini-2.5-flash' : 'gemini-2.5-flash';

      const response = await fetch('/api/think/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          problemStatement: session.problemStatement,
          currentMode: mode,
          messages: currentHistory.map((m) => ({ role: m.role, content: m.content, mode: m.mode })),
          apiKey: apiKey || undefined,
          model,
        }),
      });

      if (!response.ok) {
        throw new Error(`Stream request failed with code ${response.status}`);
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let receivedQuestions: string[] = [];
      let receivedInsights: Partial<Insight>[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const event = JSON.parse(dataStr);
              if (event.type === 'token') {
                accumulatedText += event.token;
                setStreamingText(accumulatedText);
              } else if (event.type === 'questions') {
                receivedQuestions = event.questions;
                setSuggestedQuestions(event.questions);
              } else if (event.type === 'insights') {
                receivedInsights = event.insights;
              }
            } catch {
              // Non-JSON raw token fallback
              accumulatedText += dataStr;
              setStreamingText(accumulatedText);
            }
          }
        }
      }

      // Finalize assistant message
      const assistantMsg: SessionMessage = {
        id: `msg-${Date.now()}`,
        sessionId: session.id,
        role: 'assistant',
        content: accumulatedText || 'Co-thinking synthesis generated.',
        mode,
        suggestedQuestions: receivedQuestions,
        extractedInsights: receivedInsights,
        createdAt: new Date().toISOString(),
      };

      appendStoredMessage(session.id, assistantMsg);
      setMessages((prev) => [...prev, assistantMsg]);

      // Save extracted insights
      if (receivedInsights.length > 0) {
        receivedInsights.forEach((raw) => {
          const newIns: Insight = {
            id: `ins-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            sessionId: session.id,
            category: (raw.category as any) || 'goal',
            title: raw.title || 'Extracted Insight',
            content: raw.content || '',
            status: 'under_review',
            metadata: raw.metadata,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          updateStoredInsight(session.id, newIns);
          setInsights((prev) => [...prev, newIns]);
        });
      }
    } catch (err) {
      console.error('Streaming error:', err);
      // Graceful fallback message
      const fallbackMsg: SessionMessage = {
        id: `msg-${Date.now()}`,
        sessionId: session.id,
        role: 'assistant',
        content:
          "I am ready to help you analyze this dilemma. Let's start by clarifying the primary goal and separating facts from assumptions.",
        mode,
        suggestedQuestions: [
          'What is the single most critical constraint?',
          'What does a successful resolution look like?',
        ],
        createdAt: new Date().toISOString(),
      };
      appendStoredMessage(session.id, fallbackMsg);
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  };

  const handleSendMessage = (content: string) => {
    if (!activeSession) return;
    const now = new Date().toISOString();
    const userMsg: SessionMessage = {
      id: `msg-${Date.now()}`,
      sessionId: activeSession.id,
      role: 'user',
      content,
      mode: activeSession.currentMode,
      createdAt: now,
    };

    const nextHistory = [...messages, userMsg];
    appendStoredMessage(activeSession.id, userMsg);
    setMessages(nextHistory);

    triggerAIThinking(activeSession, nextHistory, activeSession.currentMode);
  };

  const options = insights.filter((i) => i.category === 'option');

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#090d16] text-slate-100">
      {/* Top Header */}
      <AppHeader
        session={activeSession}
        onNewSession={() => setIsNewModalOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenSummary={() => setIsSummaryOpen(true)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isInsightOpen={isInsightOpen}
        onToggleInsight={() => setIsInsightOpen(!isInsightOpen)}
      />

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <SessionSidebar
          isOpen={isSidebarOpen}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={() => setIsNewModalOpen(true)}
          onRenameSession={handleRenameSession}
          onArchiveSession={handleArchiveSession}
          onDeleteSession={handleDeleteSession}
        />

        {/* Center Workspace */}
        {activeSession ? (
          <div className="flex-1 flex flex-col min-w-0">
            <ModeSelector
              currentMode={activeSession.currentMode}
              onSelectMode={handleSelectMode}
              isLoading={isStreaming}
            />

            <ThinkingWorkspace
              session={activeSession}
              messages={messages}
              streamingText={streamingText}
              isStreaming={isStreaming}
              suggestedQuestions={suggestedQuestions}
              options={options}
              onSendMessage={handleSendMessage}
              onSelectMode={handleSelectMode}
              onUpdateInsightStatus={handleUpdateInsightStatus}
            />
          </div>
        ) : (
          <HomeDashboard
            sessions={sessions}
            onSelectSession={handleSelectSession}
            onNewSession={() => setIsNewModalOpen(true)}
          />
        )}

        {/* Right Insight Panel */}
        {activeSession && (
          <InsightPanel
            isOpen={isInsightOpen}
            insights={insights}
            onUpdateInsightStatus={handleUpdateInsightStatus}
            onEditInsight={handleEditInsight}
            onDeleteInsight={handleDeleteInsight}
          />
        )}
      </div>

      {/* Modals */}
      <NewSessionModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreateSession={handleCreateSession}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onClearAllData={() => {
          clearAllLocalData();
          setSessions([]);
          setActiveSessionId(null);
          setMessages([]);
          setInsights([]);
        }}
      />

      <DecisionSummaryModal
        isOpen={isSummaryOpen}
        onClose={() => setIsSummaryOpen(false)}
        session={activeSession}
        insights={insights}
      />

      <TransitionAlertModal
        isOpen={transitionAlert.isOpen}
        onClose={() => setTransitionAlert((prev) => ({ ...prev, isOpen: false }))}
        targetMode={transitionAlert.targetMode}
        reason={transitionAlert.reason}
        warning={transitionAlert.warning}
        recommendedMode={transitionAlert.recommendedMode}
        onAcceptRecommended={(mode) => handleSelectMode(mode, true)}
        onOverride={(mode) => handleSelectMode(mode, true)}
      />
    </div>
  );
}
