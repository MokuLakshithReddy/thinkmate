'use client';

import React, { useRef, useEffect } from 'react';
import { ThinkingSession, SessionMessage, ThinkingMode, Insight, THINKING_MODES, InsightStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import { OptionsMatrix } from '@/components/thinking/OptionsMatrix';
import { SuggestedQuestions } from '@/components/thinking/SuggestedQuestions';
import {
  Send,
  User,
  Sparkles,
  Target,
  ArrowRight,
  ShieldCheck,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThinkingWorkspaceProps {
  session: ThinkingSession;
  messages: SessionMessage[];
  streamingText: string;
  isStreaming: boolean;
  suggestedQuestions: string[];
  options: Insight[];
  onSendMessage: (content: string) => void;
  onSelectMode: (mode: ThinkingMode) => void;
  onUpdateInsightStatus: (id: string, status: InsightStatus) => void;
}

export function ThinkingWorkspace({
  session,
  messages,
  streamingText,
  isStreaming,
  suggestedQuestions,
  options,
  onSendMessage,
  onSelectMode,
  onUpdateInsightStatus,
}: ThinkingWorkspaceProps) {
  const [input, setInput] = React.useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const msg = input.trim();
    setInput('');
    onSendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentModeConfig = THINKING_MODES[session.currentMode];

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-3.5rem)] bg-[#090d16] overflow-hidden">
      {/* Scrollable Conversation Stream */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl w-full mx-auto">
        {/* Session Problem Statement Hero Header */}
        <div className="rounded-2xl bg-[#0f172a] border border-slate-800 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-sky-950 text-sky-400 border border-sky-800/60">
                <Target className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-sm font-bold text-slate-100">{session.title}</h2>
            </div>
            <span
              className={cn(
                'text-[11px] px-2.5 py-0.5 rounded-full border font-medium flex items-center gap-1.5',
                currentModeConfig.badgeClass
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {currentModeConfig.name} Mode
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{session.problemStatement}</p>
        </div>

        {/* Options Matrix in Explore / Decide mode */}
        {(session.currentMode === 'explore' || session.currentMode === 'decide') && options.length > 0 && (
          <OptionsMatrix
            options={options}
            onUpdateStatus={onUpdateInsightStatus}
            onSelectOption={(opt) =>
              onSendMessage(`Let's deep dive into Option: "${opt.title}". How do we mitigate its key risks?`)
            }
          />
        )}

        {/* Message Thread */}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const msgModeConfig = THINKING_MODES[msg.mode || session.currentMode];

          return (
            <div
              key={msg.id}
              className={cn('flex gap-3 leading-relaxed', isUser ? 'justify-end' : 'justify-start')}
            >
              {!isUser && (
                <div
                  className={cn(
                    'h-8 w-8 rounded-xl flex items-center justify-center shrink-0 border mt-0.5 shadow-sm',
                    msgModeConfig.bgClass,
                    msgModeConfig.borderClass,
                    msgModeConfig.accentClass
                  )}
                >
                  <Sparkles className="h-4 w-4" />
                </div>
              )}

              <div
                className={cn(
                  'max-w-[85%] rounded-2xl p-4 text-xs',
                  isUser
                    ? 'bg-sky-600/90 text-white rounded-br-xs shadow-md shadow-sky-950/30'
                    : 'bg-[#111828] text-slate-200 border border-slate-800/80 rounded-bl-xs shadow-xs'
                )}
              >
                {!isUser && (
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800">
                    <span
                      className={cn(
                        'text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border',
                        msgModeConfig.badgeClass
                      )}
                    >
                      {msgModeConfig.name} Thinking
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}

                <div className="whitespace-pre-wrap space-y-2 text-slate-200 leading-relaxed font-sans text-xs">
                  {msg.content}
                </div>
              </div>

              {isUser && (
                <div className="h-8 w-8 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-300 shrink-0 mt-0.5 shadow-xs">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          );
        })}

        {/* Streaming Assistant Response */}
        {isStreaming && (
          <div className="flex gap-3 justify-start animate-fade-in">
            <div
              className={cn(
                'h-8 w-8 rounded-xl flex items-center justify-center shrink-0 border mt-0.5 thinking-pulse',
                currentModeConfig.bgClass,
                currentModeConfig.borderClass,
                currentModeConfig.accentClass
              )}
            >
              <Sparkles className="h-4 w-4" />
            </div>

            <div className="max-w-[85%] rounded-2xl rounded-bl-xs p-4 bg-[#111828] border border-sky-500/30 text-xs shadow-md">
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-slate-800 text-[10px]">
                <span className={cn('font-semibold uppercase tracking-wider', currentModeConfig.accentClass)}>
                  Co-Thinking in {currentModeConfig.name}...
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-ping" />
              </div>

              <div className="whitespace-pre-wrap space-y-2 text-slate-200 leading-relaxed text-xs">
                {streamingText || 'Synthesizing problem dynamics...'}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Follow-ups */}
      <SuggestedQuestions
        questions={suggestedQuestions}
        onSelectQuestion={(q) => onSendMessage(q)}
        disabled={isStreaming}
      />

      {/* Bottom Input Area */}
      <div className="p-3 bg-[#0b101d] border-t border-slate-800/80">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto">
          <div className="relative rounded-2xl bg-[#101728] border border-slate-700/80 focus-within:border-sky-500/80 focus-within:ring-1 focus-within:ring-sky-500/30 transition-all p-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={`Share context, challenge an assertion, or respond in ${currentModeConfig.name} mode... (Shift+Enter for newline)`}
              className="w-full bg-transparent border-0 text-xs text-slate-100 placeholder-slate-500 focus:outline-none resize-none px-2 py-1 leading-relaxed"
            />

            <div className="flex items-center justify-between pt-1 px-1 border-t border-slate-800/60 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">Mode:</span>
                <span
                  className={cn(
                    'text-[10px] font-medium px-2 py-0.5 rounded border',
                    currentModeConfig.badgeClass
                  )}
                >
                  {currentModeConfig.name}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 hidden sm:inline">Press Enter ↵ to send</span>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={!input.trim() || isStreaming}
                  className="h-7 px-3 text-xs"
                >
                  <Send className="h-3 w-3 mr-1" />
                  Collaborate
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
