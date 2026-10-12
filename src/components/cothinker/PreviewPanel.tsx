'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  CoThinkerStep,
  ChatMessage,
  ChoiceOption,
  WORKFLOW_STAGES,
} from '@/types';
import {
  Menu,
  RotateCw,
  Sparkles,
  Cpu,
  AlertCircle,
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

  return (
    <div className="w-full lg:w-[480px] xl:w-[540px] flex flex-col h-[calc(100vh-3.5rem)] bg-[#e6f4f8] text-slate-800 shrink-0 select-none border-l border-slate-200">
      {/* Top Tabs: Preview | Console | Step | Theme (Matching Image 1) */}
      <div className="pt-2 px-4 flex items-center justify-center border-b border-sky-100 bg-[#e0f1f6]/60">
        <div className="flex items-center gap-1 p-1 bg-sky-200/50 rounded-xl text-xs font-medium text-slate-700">
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'px-3.5 py-1 rounded-lg transition-all cursor-pointer',
              activeTab === 'preview'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'hover:text-slate-900'
            )}
          >
            Preview
          </button>
          <button
            onClick={() => setActiveTab('console')}
            className={cn(
              'px-3.5 py-1 rounded-lg transition-all cursor-pointer',
              activeTab === 'console'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'hover:text-slate-900'
            )}
          >
            Console
          </button>
          <button
            onClick={() => setActiveTab('step')}
            className={cn(
              'px-3.5 py-1 rounded-lg transition-all cursor-pointer',
              activeTab === 'step'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'hover:text-slate-900'
            )}
          >
            Step
          </button>
          <button
            onClick={() => setActiveTab('theme')}
            className={cn(
              'px-3.5 py-1 rounded-lg transition-all cursor-pointer',
              activeTab === 'theme'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'hover:text-slate-900'
            )}
          >
            Theme
          </button>
        </div>
      </div>

      {/* Action Header: Hamburger Menu, Progress Line, Reload (Matching Image 1) */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-sky-100 bg-[#e6f4f8]">
        <button
          onClick={() => {}}
          className="p-1 rounded text-slate-600 hover:text-slate-900 cursor-pointer"
          title="Workflow stages"
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Progress Bar Track with Teal Indicator */}
        <div className="flex-1 max-w-xs mx-3 flex items-center gap-2">
          <div className="w-full bg-slate-700/80 h-1.5 rounded-full overflow-hidden p-0.5">
            <div
              className="bg-teal-400 h-full rounded-full transition-all duration-500 shadow-xs"
              style={{ width: `${Math.max(progressPercent, 10)}%` }}
            />
          </div>
        </div>

        <button
          onClick={onRestart}
          className="p-1 rounded text-slate-600 hover:text-slate-900 cursor-pointer"
          title="Restart co-thinking session"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tab: Console */}
      {activeTab === 'console' && (
        <div className="flex-1 p-4 bg-slate-900 text-slate-200 font-mono text-xs overflow-y-auto space-y-2">
          <div className="text-teal-400">Co-Thinker Runtime Diagnostic Console</div>
          <div>[STAGE] Current Step: {currentStageInfo.label} (Step {currentStageInfo.number}/8)</div>
          <div>[NODE] Active Node: Co-think Assistant</div>
          <div>[SESSION] ID: {activeSessionId || 'Transient Session'}</div>
          <div>[USER] Authenticated Profile: {userName}</div>
          <div>[PROGRESS] Flow Progression: {progressPercent}%</div>
          <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400">
            Execution mode is stamped explicitly on every response turn.
          </div>
        </div>
      )}

      {/* Tab: Step */}
      {activeTab === 'step' && (
        <div className="flex-1 p-4 bg-white overflow-y-auto space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Current Flowchart Step: {currentStageInfo.number} / 8
          </h3>
          <div className="p-3 bg-purple-50 rounded-xl border border-purple-200">
            <div className="font-semibold text-purple-900 text-xs">{currentStageInfo.label}</div>
            <p className="text-xs text-purple-700 mt-1">{currentStageInfo.shortDescription}</p>
          </div>
          <div className="text-xs text-slate-600 leading-relaxed">
            <strong>Internal Prompt Instruction:</strong>
            <p className="mt-1 p-2 bg-slate-50 rounded border border-slate-200 font-mono text-[11px]">
              {currentStageInfo.nodeInstruction}
            </p>
          </div>
        </div>
      )}

      {/* Tab: Theme */}
      {activeTab === 'theme' && (
        <div className="flex-1 p-4 bg-white overflow-y-auto space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Interface Theme
          </h3>
          <p className="text-xs text-slate-600">
            Currently using the official Co-Thinker Ice Blue theme (`#E6F4F8`).
          </p>
        </div>
      )}

      {/* Tab: Preview (Main Chat / Co-Thinker View Matching Image 1) */}
      {activeTab === 'preview' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Scrollable Conversation History */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 font-sans text-xs sm:text-[13px] leading-relaxed text-slate-800">
            {messages.map((msg) => {
              const isAssistant = msg.role === 'assistant';
              return (
                <div
                  key={msg.id}
                  className={cn(
                    'animate-fade-in transition-all',
                    isAssistant ? 'text-slate-800 space-y-1.5' : 'text-slate-900 font-medium pl-4 border-l-2 border-teal-500'
                  )}
                >
                  {/* Explicit Execution Mode Badge (P0 Alignment) */}
                  {isAssistant && msg.executionMode && (
                    <div className="flex items-center gap-1.5 mb-1">
                      {msg.executionMode === 'gemini' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          <Sparkles className="h-3 w-3 text-emerald-600" />
                          Live {msg.modelName || 'Gemini 2.5 Flash'}
                        </span>
                      )}
                      {msg.executionMode === 'simulator' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                          <Cpu className="h-3 w-3 text-amber-700" />
                          Flowchart Simulator (Deterministic)
                        </span>
                      )}
                      {msg.executionMode === 'error' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800 border border-rose-300">
                          <AlertCircle className="h-3 w-3 text-rose-600" />
                          API Error
                        </span>
                      )}
                    </div>
                  )}

                  {/* Optional Simulation or Fallback Notice */}
                  {isAssistant && msg.simulatedNotice && (
                    <div className="text-[11px] text-amber-900/90 bg-amber-50/80 border border-amber-200/80 rounded-lg p-2 italic">
                      {msg.simulatedNotice}
                    </div>
                  )}

                  <div className="whitespace-pre-wrap leading-relaxed space-y-2">
                    {msg.content}
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-center gap-2 text-slate-500 text-xs italic py-2">
                <span className="h-2 w-2 rounded-full bg-teal-500 animate-ping" />
                Co-thinker is processing perspectives...
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Interactive Options Area (Radio Pill Buttons matching Image 1) */}
          <div className="p-4 bg-[#e6f4f8] border-t border-sky-100 space-y-3">
            {currentOptions && currentOptions.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {currentOptions.map((opt) => {
                  const isSelected = effectiveSelectedOption === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => setSelectedOption(opt.id)}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-2xl bg-white border transition-all cursor-pointer shadow-xs select-none',
                        isSelected
                          ? 'border-slate-800 ring-1 ring-slate-800'
                          : 'border-slate-200/80 hover:border-slate-400'
                      )}
                    >
                      {/* Radio Circle */}
                      <div
                        className={cn(
                          'h-4 w-4 rounded-full border flex items-center justify-center shrink-0 transition-all',
                          isSelected
                            ? 'border-slate-900 bg-white'
                            : 'border-slate-300 bg-white'
                        )}
                      >
                        {isSelected && (
                          <div className="h-2 w-2 rounded-full bg-slate-900" />
                        )}
                      </div>

                      <div className="text-xs font-medium text-slate-800 leading-tight">
                        {opt.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Freeform Problem / Context Input Box */}
            <div className="relative rounded-2xl bg-white border border-slate-300 focus-within:border-slate-800 shadow-xs p-1 flex items-center gap-1.5">
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
                    ? 'Describe your dilemma or situation here...'
                    : 'Add specific context, or submit the selected choice above...'
                }
                className="flex-1 bg-transparent border-0 px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none"
              />

              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={isLoading || (!effectiveSelectedOption && !inputText.trim())}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs shrink-0 flex items-center gap-1"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
