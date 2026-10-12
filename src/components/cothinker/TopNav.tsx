'use client';

import React from 'react';
import { ArrowLeft, Cloud, Share2, Sparkles, Settings, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopNavProps {
  viewMode: 'editor' | 'app';
  onViewModeChange: (mode: 'editor' | 'app') => void;
  onOpenSettings: () => void;
  onShare: () => void;
  userName?: string;
}

export function TopNav({
  viewMode,
  onViewModeChange,
  onOpenSettings,
  onShare,
  userName = 'Lakshith Reddy',
}: TopNavProps) {
  return (
    <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between sticky top-0 z-50 select-none shadow-xs">
      {/* Left: Back Arrow + Co-Thinker Title + Published Badge */}
      <div className="flex items-center gap-3">
        <button
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Back to projects"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-slate-900 text-sm tracking-tight">Co-Thinker</h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
            <Cloud className="h-3 w-3 text-slate-500" />
            Published
          </span>
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

      {/* Right: Share, Remix, Settings, Profile Avatar */}
      <div className="flex items-center gap-2">
        <button
          onClick={onShare}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-full transition-colors cursor-pointer shadow-xs"
        >
          <Share2 className="h-3.5 w-3.5 text-slate-600" />
          Share
        </button>

        <button
          onClick={() => alert('Remixed project successfully into your workspace!')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-full transition-colors cursor-pointer shadow-xs"
        >
          <Sparkles className="h-3.5 w-3.5 text-purple-300" />
          Remix
        </button>

        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>

        {/* User Avatar */}
        <div
          className="h-7 w-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold cursor-pointer ring-2 ring-purple-100"
          title={userName}
        >
          {userName.charAt(0)}
        </div>
      </div>
    </header>
  );
}
