'use client';

import React from 'react';
import { ThinkingMode, THINKING_MODES } from '@/types';
import { cn } from '@/lib/utils';
import {
  HelpCircle,
  Compass,
  ShieldAlert,
  CheckCircle2,
  ListTodo,
  ArrowRight,
} from 'lucide-react';

interface ModeSelectorProps {
  currentMode: ThinkingMode;
  onSelectMode: (mode: ThinkingMode) => void;
  isLoading?: boolean;
}

export function ModeSelector({ currentMode, onSelectMode, isLoading }: ModeSelectorProps) {
  const modes: ThinkingMode[] = ['understand', 'explore', 'challenge', 'decide', 'act'];

  const modeIcons: Record<ThinkingMode, React.ReactNode> = {
    understand: <HelpCircle className="h-4 w-4" />,
    explore: <Compass className="h-4 w-4" />,
    challenge: <ShieldAlert className="h-4 w-4" />,
    decide: <CheckCircle2 className="h-4 w-4" />,
    act: <ListTodo className="h-4 w-4" />,
  };

  const currentConfig = THINKING_MODES[currentMode];

  return (
    <div className="w-full bg-[#0d1424] border-b border-slate-800/80 px-4 py-2.5">
      {/* Modes Navigation Bar */}
      <div className="flex items-center justify-between gap-1 max-w-4xl mx-auto overflow-x-auto scrollbar-none pb-1">
        {modes.map((modeKey, index) => {
          const config = THINKING_MODES[modeKey];
          const isCurrent = modeKey === currentMode;

          return (
            <React.Fragment key={modeKey}>
              <button
                onClick={() => onSelectMode(modeKey)}
                disabled={isLoading}
                className={cn(
                  'group flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all shrink-0 cursor-pointer disabled:opacity-50',
                  isCurrent
                    ? `${config.bgClass} ${config.borderClass} ${config.accentClass} shadow-xs font-semibold ring-1 ring-sky-500/20`
                    : 'bg-[#101728]/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-[#131d33] hover:border-slate-700'
                )}
              >
                <span className={cn('p-1 rounded-md transition-colors', isCurrent ? config.accentClass : 'text-slate-500')}>
                  {modeIcons[modeKey]}
                </span>
                <span className="tracking-tight">{config.name}</span>
                {isCurrent && (
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                )}
              </button>

              {index < modes.length - 1 && (
                <ArrowRight className="h-3 w-3 text-slate-700 shrink-0 hidden sm:block" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Mode Context Hint Banner */}
      <div className="mt-2 text-center text-[11px] text-slate-400 max-w-2xl mx-auto flex items-center justify-center gap-2 bg-[#0a0f1d] py-1 px-3 rounded-lg border border-slate-800/60">
        <span className={cn('font-semibold uppercase tracking-wider text-[10px]', currentConfig.accentClass)}>
          {currentConfig.name} Focus:
        </span>
        <span className="text-slate-300">{currentConfig.tagline}</span>
        <span className="text-slate-500 hidden md:inline">— {currentConfig.objective}</span>
      </div>
    </div>
  );
}
