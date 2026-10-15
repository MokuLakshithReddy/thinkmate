'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  CoThinkerStep,
  ChatMessage,
  ChoiceOption,
  WORKFLOW_STAGES,
  ThinkingMode,
} from '@/types';
import {
  RotateCw,
  Sparkles,
  Cpu,
  AlertCircle,
  MessageSquare,
  Layers,
  Terminal,
  Palette,
  Send,
  Check,
  BrainCircuit,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PreviewPanelProps {
  currentStep: CoThinkerStep;
  progressPercent: number;
  messages: ChatMessage[];
  currentOptions?: ChoiceOption[];
  isLoading: boolean;
  onSendMessage: (text: string, selectedOptionId?: string) => void;
  onRestart: () => void;
  userName?: string;
  activeSessionId?: string | null;
}

export function PreviewPanel({
  currentStep,
  progressPercent,
  messages,
  currentOptions,
  isLoading,
  onSendMessage,
  onRestart,
  userName = 'User',
  activeSessionId,
}: PreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'console' | 'step' | 'theme'>('preview');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Determine active selected option fallback
  const effectiveSelectedOption =
    selectedOption && currentOptions?.some((o) => o.id === selectedOption)
      ? selectedOption
      : currentOptions && currentOptions.length > 0
      ? currentOptions[0].id
      : null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isLoading) return;

    if (inputText.trim()) {
      onSendMessage(inputText.trim(), effectiveSelectedOption || undefined);
      setInputText('');
      setSelectedOption(null);
    } else if (effectiveSelectedOption) {
      const opt = currentOptions?.find((o) => o.id === effectiveSelectedOption);
      onSendMessage(opt?.label || effectiveSelectedOption, effectiveSelectedOption);
      setSelectedOption(null);
    }
  };

  const currentStageInfo = WORKFLOW_STAGES[currentStep];

  // Map step to authoritative mode metadata
  const getStepMode = (step: CoThinkerStep): { mode: ThinkingMode; label: string; badge: string; color: string; progressGradient: string } => {
    switch (step) {
      case 'welcome':
      case 'describe_problem':
      case 'clarify_objective':
      case 'break_subproblems':
        return {
          mode: 'understand',
          label: 'Understand',
          badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          color: 'text-indigo-600',
          progressGradient: 'from-indigo-500 to-purple-500',
        };
      case 'explore_perspectives':
        return {
          mode: 'explore',
          label: 'Explore',
          badge: 'bg-sky-50 text-sky-700 border-sky-200',
          color: 'text-sky-600',
          progressGradient: 'from-sky-500 to-cyan-400',
        };
      case 'challenge_assumptions':
        return {
          mode: 'challenge',
          label: 'Challenge',
          badge: 'bg-amber-50 text-amber-800 border-amber-200',
          color: 'text-amber-600',
          progressGradient: 'from-amber-500 to-orange-400',
        };
      case 'check_satisfaction':
      case 'summarize_insights':
        return {
          mode: 'decide',
          label: 'Decide',
          badge: 'bg-purple-50 text-purple-700 border-purple-200',
          color: 'text-purple-600',
          progressGradient: 'from-purple-500 to-fuchsia-400',
        };
      case 'choose_action':
        return {
          mode: 'act',
          label: 'Act',
          badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          color: 'text-emerald-600',
          progressGradient: 'from-emerald-500 to-teal-400',
        };
    }
  };

  const modeMeta = getStepMode(currentStep);

  return (
    <div className="w-full flex-1 flex flex-col h-[calc(100vh-3.5rem)] bg-white text-slate-800 border-l border-slate-200/80 overflow-hidden">
      {/* Top Segmented Tabs: Chat Studio | Stage Blueprint | Console | Theme */}
      <div className="pt-2 px-4 pb-2 flex items-center justify-between border-b border-slate-100 bg-slate-50/70 backdrop-blur-xs">
        <div className="flex items-center gap-1 p-0.5 bg-slate-200/60 rounded-xl text-xs font-medium text-slate-600">
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all cursor-pointer',
              activeTab === 'preview'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'hover:text-slate-900'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 text-purple-600" />
            <span>Chat Studio</span>
          </button>

          <button
            onClick={() => setActiveTab('step')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all cursor-pointer',
              activeTab === 'step'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'hover:text-slate-900'
            )}
          >
            <Layers className="h-3.5 w-3.5 text-indigo-600" />
            <span>Blueprint</span>
          </button>

          <button
            onClick={() => setActiveTab('console')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all cursor-pointer',
              activeTab === 'console'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'hover:text-slate-900'
            )}
          >
            <Terminal className="h-3.5 w-3.5 text-slate-600" />
            <span>Console</span>
          </button>

          <button
            onClick={() => setActiveTab('theme')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer',
              activeTab === 'theme'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'hover:text-slate-900'
            )}
          >
            <Palette className="h-3.5 w-3.5 text-slate-600" />
            <span className="hidden sm:inline">Theme</span>
          </button>
        </div>

        {/* Quick Restart Action */}
        <button
          onClick={onRestart}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          title="Restart co-thinking session"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Action Header: Mode Pill, Stage Info, Progress Bar */}
      <div className="px-5 py-2.5 flex items-center justify-between border-b border-slate-100 bg-white">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shadow-2xs', modeMeta.badge)}>
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            {modeMeta.label} Mode
          </span>
          <span className="text-xs text-slate-500 font-medium hidden sm:inline">
            Stage {currentStageInfo.number}/8: {currentStageInfo.label}
          </span>
        </div>

        {/* Dynamic Progress Bar */}
        <div className="flex items-center gap-2.5 w-32 sm:w-48">
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden p-0.5 border border-slate-200/60">
            <div
              className={cn('h-full rounded-full transition-all duration-500 shadow-2xs bg-gradient-to-r', modeMeta.progressGradient)}
              style={{ width: `${Math.max(progressPercent, 12)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono font-medium text-slate-400 shrink-0">
            {progressPercent}%
          </span>
        </div>
      </div>

      {/* Tab: Console */}
      {activeTab === 'console' && (
        <div className="flex-1 p-5 bg-slate-950 text-slate-200 font-mono text-xs overflow-y-auto space-y-2.5">
          <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
            <Terminal className="h-4 w-4" />
            <span>Co-Thinker Runtime Diagnostic Console</span>
          </div>
          <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1.5 text-[11px]">
            <div><span className="text-slate-400">[STAGE]</span> Current Step: {currentStageInfo.label} (Step {currentStageInfo.number}/8)</div>
            <div><span className="text-slate-400">[MODE]</span> Active Cognitive Mode: {modeMeta.label}</div>
            <div><span className="text-slate-400">[SESSION]</span> ID: {activeSessionId || 'Transient Session'}</div>
            <div><span className="text-slate-400">[USER]</span> Profile: {userName}</div>
            <div><span className="text-slate-400">[PROGRESS]</span> Flow Progression: {progressPercent}%</div>
          </div>
          <div className="pt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-slate-500" />
            <span>Cryptographic payload verification and row locks active on transactional step commits.</span>
          </div>
        </div>
      )}

      {/* Tab: Step / Stage Blueprint */}
      {activeTab === 'step' && (
        <div className="flex-1 p-6 bg-slate-50/50 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Stage {currentStageInfo.number} of 8: {currentStageInfo.label}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">{currentStageInfo.shortDescription}</p>
            </div>
            <span className={cn('text-xs px-2.5 py-1 rounded-full font-semibold border shadow-2xs', modeMeta.badge)}>
              {modeMeta.label} Mode
            </span>
          </div>

          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <BrainCircuit className="h-4 w-4 text-purple-600" />
              <span>Prompt Instruction Directive</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed font-mono bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              {currentStageInfo.nodeInstruction}
            </p>
          </div>

          {currentStageInfo.memoryKey && (
            <div className="p-4 bg-purple-50/60 rounded-2xl border border-purple-200/80 text-xs space-y-1">
              <div className="font-semibold text-purple-900 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                <span>Memory Retrieval Key: {currentStageInfo.memoryKey}</span>
              </div>
              <p className="text-purple-700">
                The co-thinker leverages this context pillar to cross-reference previous decisions, constraints, and perspectives.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Theme */}
      {activeTab === 'theme' && (
        <div className="flex-1 p-6 bg-slate-50/50 overflow-y-auto space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            Co-Thinker Studio Aesthetics
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-white border-2 border-purple-500 shadow-xs space-y-1.5">
              <div className="font-semibold text-xs text-slate-900 flex items-center justify-between">
                <span>Studio Modern (Light)</span>
                <Check className="h-4 w-4 text-purple-600" />
              </div>
              <p className="text-[11px] text-slate-500">
                Clean high-contrast palette with soft pastel mode accents and high-definition grid canvas.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Preview (Main Chat Studio) */}
      {activeTab === 'preview' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30">
          {/* Scrollable Conversation History */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 font-sans text-xs sm:text-[13px] leading-relaxed">
            {messages.map((msg) => {
              const isAssistant = msg.role === 'assistant';
              return (
                <div
                  key={msg.id}
                  className={cn(
                    'animate-fade-in transition-all flex flex-col',
                    isAssistant ? 'items-start' : 'items-end'
                  )}
                >
                  {/* Assistant Message Card */}
                  {isAssistant ? (
                    <div className="max-w-2xl w-full bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs shadow-slate-900/5 space-y-2.5">
                      {/* Assistant Header: Avatar + Model Tag */}
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-2xs">
                            <Sparkles className="h-3.5 w-3.5" />
                          </div>
                          <span className="font-semibold text-slate-900 text-xs">ThinkMate</span>
                        </div>

                        {/* Model Execution Badge */}
                        {msg.executionMode && (
                          <div className="flex items-center gap-1.5">
                            {msg.executionMode === 'gemini' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <Sparkles className="h-3 w-3 text-emerald-600" />
                                {msg.modelName || 'Gemini 2.5 Flash'}
                              </span>
                            )}
                            {msg.executionMode === 'simulator' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                <Cpu className="h-3 w-3 text-indigo-600" />
                                Co-Thinker Engine
                              </span>
                            )}
                            {msg.executionMode === 'error' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                <AlertCircle className="h-3 w-3 text-rose-600" />
                                API Fallback
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Optional Notice */}
                      {msg.simulatedNotice && (
                        <div className="text-[11px] text-amber-800 bg-amber-50/90 border border-amber-200 rounded-xl p-2.5 flex items-center gap-2">
                          <Info className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span>{msg.simulatedNotice}</span>
                        </div>
                      )}

                      {/* Message Content */}
                      <div className="whitespace-pre-wrap leading-relaxed text-slate-700 select-text">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    /* User Message Bubble */
                    <div className="max-w-xl bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl rounded-tr-xs px-4 py-2.5 shadow-xs font-medium select-text">
                      <div className="whitespace-pre-wrap text-xs sm:text-[13px] leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="flex items-center gap-2.5 text-slate-500 text-xs italic py-2 bg-white/80 border border-slate-200/80 rounded-2xl px-4 py-3 max-w-sm">
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-purple-600 animate-bounce" />
                  <span className="h-2 w-2 rounded-full bg-indigo-600 animate-bounce [animation-delay:0.2s]" />
                  <span className="h-2 w-2 rounded-full bg-sky-500 animate-bounce [animation-delay:0.4s]" />
                </div>
                <span>Co-thinker is analyzing perspectives...</span>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Interactive Choices & Input Dock */}
          <div className="p-4 bg-white/95 backdrop-blur-md border-t border-slate-200/80 space-y-3 shadow-lg shadow-slate-900/5">
            {/* Multi-Choice Option Cards */}
            {currentOptions && currentOptions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                  Suggested Next Moves
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {currentOptions.map((opt, idx) => {
                    const isSelected = effectiveSelectedOption === opt.id;
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        key={opt.id}
                        onClick={() => setSelectedOption(opt.id)}
                        className={cn(
                          'flex items-center text-left gap-3 p-3 rounded-2xl border transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500',
                          isSelected
                            ? 'bg-purple-50/60 border-purple-500 ring-1 ring-purple-400 text-purple-950 font-semibold'
                            : 'bg-white border-slate-200/90 hover:border-purple-300 hover:bg-slate-50/60 text-slate-800'
                        )}
                      >
                        {/* Radio Ring */}
                        <div
                          className={cn(
                            'h-4 w-4 rounded-full border flex items-center justify-center shrink-0 transition-all',
                            isSelected
                              ? 'border-purple-600 bg-purple-600 text-white'
                              : 'border-slate-300 bg-white'
                          )}
                          aria-hidden="true"
                        >
                          {isSelected && (
                            <div className="h-1.5 w-1.5 rounded-full bg-white" />
                          )}
                        </div>

                        <div className="flex-1 text-xs leading-tight">
                          {opt.label}
                        </div>

                        <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-100/80">
                          {idx + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Context Input Field & Send Action */}
            <div className="relative rounded-2xl bg-slate-100/80 border border-slate-200/90 focus-within:bg-white focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100 transition-all p-1.5 flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSubmit();
                  }
                }}
                placeholder={
                  currentStep === 'describe_problem'
                    ? 'Type your dilemma, tension, or situation here...'
                    : 'Add specific details, or submit the selected choice above...'
                }
                className="flex-1 bg-transparent border-0 px-3 py-1.5 text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
              />

              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={isLoading || (!effectiveSelectedOption && !inputText.trim())}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-xs transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs active:scale-95 shrink-0 flex items-center gap-1.5"
              >
                <span>Submit</span>
                <Send className="h-3 w-3" />
              </button>
            </div>

            {/* Helpful Input Helper */}
            <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
              <span>Press <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">Enter</kbd> to submit</span>
              <span>Co-thinking with ThinkMate</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

