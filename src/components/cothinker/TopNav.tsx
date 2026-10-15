'use client';

import React from 'react';
import {
  ArrowLeft,
  Cloud,
  Share2,
  Sparkles,
  Settings,
  LogIn,
  LogOut,
  Workflow,
  MessageSquare,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopNavProps {
  viewMode: 'editor' | 'app';
  onViewModeChange: (mode: 'editor' | 'app') => void;
  onOpenSettings: () => void;
  onShare: () => void;
  userName?: string;
  userEmail?: string;
  isAuthenticated?: boolean;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
  onBack?: () => void;
  onRemix?: () => void;
}

export function TopNav({
  viewMode,
  onViewModeChange,
  onOpenSettings,
  onShare,
  userName = 'Thinker',
  userEmail,
  isAuthenticated = false,
  onOpenAuth,
  onSignOut,
  onBack,
  onRemix,
}: TopNavProps) {
  return (
    <header className="h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-50 select-none shadow-xs">
      {/* Left: Brand Identity + Problem Navigation + Cloud Status */}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Reset to kickoff / start new problem"
            aria-label="Back to kickoff"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}

        {/* Brand Icon & Logo */}
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-xs shadow-purple-500/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-bold text-slate-900 text-sm tracking-tight">Think<span className="text-purple-600">Mate</span></span>
            <span className="text-[11px] font-medium text-slate-400 hidden sm:inline-block">/ Co-Thinker</span>
          </div>
        </div>

        {/* Sync Status Badge */}
        <div className="hidden md:flex items-center">
          {isAuthenticated ? (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-xs"
              title="Encrypted cloud sync active"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <Cloud className="h-3 w-3 text-emerald-600" />
              Cloud Synced
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200/80"
              title="Working in local memory. Sign in to synchronize across devices."
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Local Draft
            </span>
          )}
        </div>
      </div>

      {/* Center: Studio / Focus Mode Pill Toggle */}
      <div className="flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 shadow-2xs">
        <button
          onClick={() => onViewModeChange('editor')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer',
            viewMode === 'editor'
              ? 'bg-white text-purple-700 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          <Workflow className="h-3.5 w-3.5" />
          <span>Split Studio</span>
        </button>
        <button
          onClick={() => onViewModeChange('app')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer',
            viewMode === 'app'
              ? 'bg-white text-purple-700 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>Focus Chat</span>
        </button>
      </div>

      {/* Right: Actions, Fork, Settings & Profile */}
      <div className="flex items-center gap-2">
        {onRemix && (
          <button
            onClick={onRemix}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-full transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-95"
            title="Branch this problem statement into a new exploration path"
          >
            <Copy className="h-3.5 w-3.5 text-purple-600" />
            <span>Branch</span>
          </button>
        )}

        <button
          onClick={onShare}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200/90 rounded-full transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-95"
        >
          <Share2 className="h-3.5 w-3.5 text-slate-500" />
          <span className="hidden sm:inline">Share</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="p-2 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Settings & System Diagnostics"
        >
          <Settings className="h-4 w-4" />
        </button>

        {/* Auth / Profile Area */}
        {isAuthenticated ? (
          <div className="flex items-center gap-1.5 pl-1.5 border-l border-slate-200">
            <div
              className="h-7 w-7 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center text-xs font-semibold shadow-xs ring-2 ring-purple-100"
              title={userEmail || userName}
            >
              {(userEmail || userName).charAt(0).toUpperCase()}
            </div>
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                title="Sign out of ThinkMate"
                aria-label="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-full transition-all cursor-pointer shadow-xs active:scale-95"
          >
            <LogIn className="h-3.5 w-3.5 text-slate-300" />
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
}

