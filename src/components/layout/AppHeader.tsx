'use client';

import React from 'react';
import { ThinkingSession, THINKING_MODES } from '@/types';
import { Button } from '@/components/ui/Button';
import {
  Brain,
  Plus,
  Settings,
  FileCheck,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

interface AppHeaderProps {
  session?: ThinkingSession | null;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onOpenSummary: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isInsightOpen: boolean;
  onToggleInsight: () => void;
}

export function AppHeader({
  session,
  onNewSession,
  onOpenSettings,
  onOpenSummary,
  isSidebarOpen,
  onToggleSidebar,
  isInsightOpen,
  onToggleInsight,
}: AppHeaderProps) {
  const currentModeConfig = session ? THINKING_MODES[session.currentMode] : null;

  return (
    <header className="h-14 border-b border-slate-800/80 bg-[#0b101d]/90 backdrop-blur-md px-4 flex items-center justify-between sticky top-0 z-40 select-none">
      {/* Left: Brand and Sidebar Toggle */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className="text-slate-400 hover:text-slate-200"
          title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>

        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-sky-950/80 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-inner">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm tracking-tight text-slate-100">ThinkMate</span>
              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-sm bg-sky-950/90 text-sky-400 border border-sky-800/60 uppercase tracking-wider">
                Partner
              </span>
            </div>
          </div>
        </div>

        {session && (
          <div className="hidden md:flex items-center gap-2 pl-3 ml-2 border-l border-slate-800">
            <span className="text-xs font-medium text-slate-300 max-w-xs truncate" title={session.title}>
              {session.title}
            </span>
            {currentModeConfig && (
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${currentModeConfig.badgeClass} flex items-center gap-1`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                {currentModeConfig.name} Mode
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {session && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenSummary}
            className="text-xs border-emerald-800/40 hover:border-emerald-700/60 text-emerald-300 hover:text-emerald-200 bg-emerald-950/20"
          >
            <FileCheck className="h-3.5 w-3.5 mr-1 text-emerald-400" />
            Decision Synthesis
          </Button>
        )}

        <Button variant="primary" size="sm" onClick={onNewSession} className="text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Problem
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          className="text-slate-400 hover:text-slate-200"
          title="Settings & Privacy"
        >
          <Settings className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleInsight}
          className="text-slate-400 hover:text-slate-200"
          title={isInsightOpen ? 'Close Insight Panel' : 'Open Insight Panel'}
        >
          {isInsightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}
