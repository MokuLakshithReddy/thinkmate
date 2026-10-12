'use client';

import React, { useState } from 'react';
import { CoThinkerStep, ChatMessage, ChoiceOption } from '@/types';
import { TopNav } from '@/components/cothinker/TopNav';
import { WorkflowCanvas } from '@/components/cothinker/WorkflowCanvas';
import { PreviewPanel } from '@/components/cothinker/PreviewPanel';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { clearAllLocalData } from '@/lib/storage';

export default function Home() {
  const [viewMode, setViewMode] = useState<'editor' | 'app'>('editor');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Workflow State
  const [currentStep, setCurrentStep] = useState<CoThinkerStep>('welcome');
  const [progressPercent, setProgressPercent] = useState(10);
  const [problemStatement, setProblemStatement] = useState<string>('');
  const [clarifiedObjective, setClarifiedObjective] = useState<string>('');

  // Initial welcome message matching Image 1
  const initialMessages: ChatMessage[] = [
    {
      id: 'msg-init-1',
      role: 'assistant',
      step: 'welcome',
      timestamp: '2026-10-12T00:00:00.000Z',
      content: `Hello Lakshith Reddy! It's great to be co-thinking with you again.

To catch us up, here are the main things we've explored:

1. **Women's Safety AI**: We moved from CCTV concepts to the "Pulse Guardian" wearable for "Dark Zones."
2. **Oceanographic Dashboard**: We briefly analyzed wireframes for sea temperature monitoring.
3. **Logistics SH-205**: We've been working on your hackathon project, most recently refining a "Multi-Modal Recovery Broker" to find the optimal way to rescue misplaced shipments.

Would you like to continue working on the SH-205 project, or would you like to start on a completely new problem today?`,
      options: [
        { id: 'resume_sh205', label: 'Pick up SH-205 (Logistics Recovery)' },
        { id: 'start_new', label: 'Start a totally new problem' },
      ],
    },
  ];

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [currentOptions, setCurrentOptions] = useState<ChoiceOption[] | undefined>(
    initialMessages[0].options
  );

  const handleSendMessage = async (text: string, selectedOptionId?: string) => {
    // Append user message to thread
    const userMsg: ChatMessage = {
      id: `msg-user-${Date.now()}`,
      role: 'user',
      content: text,
      step: currentStep,
      timestamp: new Date().toISOString(),
      selectedOptionId,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
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
          userName: 'Lakshith Reddy',
          problemStatement,
          clarifiedObjective,
          history: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to process co-thinking step: ${res.status}`);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: `msg-ast-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        step: data.nextStep,
        options: data.options,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentStep(data.nextStep);
      setCurrentOptions(data.options);
      setProgressPercent(data.progressPercent || 50);

      if (data.nextStep === 'break_subproblems') {
        setClarifiedObjective(text);
      }
    } catch (err) {
      console.error('Co-think communication error:', err);
      // Resilient fallback assistant response
      const fallbackMsg: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        role: 'assistant',
        content: `I understand your perspective: "${text}". Let's move forward in clarifying the core objective.`,
        step: 'clarify_objective',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, fallbackMsg]);
      setCurrentStep('clarify_objective');
      setProgressPercent(30);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = () => {
    setCurrentStep('welcome');
    setProgressPercent(10);
    setProblemStatement('');
    setClarifiedObjective('');
    setMessages(initialMessages);
    setCurrentOptions(initialMessages[0].options);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white text-slate-900 font-sans">
      {/* Top Navigation matching Image 1 */}
      <TopNav
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onShare={() => alert('Co-Thinker link copied to clipboard!')}
        userName="Lakshith Reddy"
      />

      {/* Main Dual-Pane Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Infinite Workflow Node Canvas (Visible in Editor mode, can collapse in full App mode) */}
        {viewMode === 'editor' && (
          <WorkflowCanvas currentStep={currentStep} isLoading={isLoading} />
        )}

        {/* Right: Interactive Co-Thinker Chat / Preview Panel matching Image 1 */}
        <div className={viewMode === 'app' ? 'flex-1 flex justify-center bg-[#f0f9fb]' : ''}>
          <PreviewPanel
            currentStep={currentStep}
            progressPercent={progressPercent}
            messages={messages}
            currentOptions={currentOptions}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onRestart={handleRestart}
            userName="Lakshith Reddy"
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
