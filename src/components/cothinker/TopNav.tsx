'use client';

import React from 'react';
import { ArrowLeft, Cloud, Share2, Sparkles, Settings, LogIn, LogOut } from 'lucide-react';
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
    <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between sticky top-0 z-50 select-none shadow-xs">
      {/* Left: Back Arrow + Co-Thinker Title + Truthful Sync Status */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Back to welcome / new problem"
          aria-label="Back to welcome"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-slate-900 text-sm tracking-tight">Co-Thinker</h1>
          {isAuthenticated ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
              title="Cloud persistence active with server-managed session cookies"
            >
              <Cloud className="h-3 w-3 text-emerald-600" />
              Cloud Synced
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200"
              title="Working in local browser memory. Sign in to synchronize across devices."
            >
              Local Draft
            </span>
          )}
        </div>
      </div>

      {/* Center: Editor / App Pill Toggle */}
      <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
        <button
          onClick={() => onViewModeChange('editor')}
          className={cn(
            'px-3.5 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer',
            viewMode === 'editor'
              ? 'bg-purple-100 text-purple-700 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          Editor
        </button>
        <button
          onClick={() => onViewModeChange('app')}
          className={cn(
            'px-3.5 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer',
            viewMode === 'app'
              ? 'bg-purple-100 text-purple-700 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          App
        </button>
      </div>

      {/* Right: Share, Remix/Fork, Settings, Authentication */}
      <div className="flex items-center gap-2">
        <button
          onClick={onShare}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-full transition-colors cursor-pointer shadow-xs"
        >
          <Share2 className="h-3.5 w-3.5 text-slate-600" />
          Share
        </button>

        {onRemix && (
          <button
            onClick={onRemix}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-full transition-colors cursor-pointer shadow-xs"
            title="Duplicate current problem statement into a new session branch"
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-300" />
            Duplicate
          </button>
        )}

        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Settings & Model Selection"
        >
          <Settings className="h-4 w-4" />
        </button>

        {/* Authentication State Control */}
        {isAuthenticated ? (
          <div className="flex items-center gap-1.5 pl-1 border-l border-slate-200">
            <div
              className="h-7 w-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold ring-2 ring-purple-100"
              title={userEmail || userName}
            >
              {(userEmail || userName).charAt(0).toUpperCase()}
            </div>
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-full transition-colors cursor-pointer shadow-2xs"
          >
            <LogIn className="h-3.5 w-3.5 text-sky-600" />
            Sign In
          </button>
        )}
      </div>
    </header>
  );
}
