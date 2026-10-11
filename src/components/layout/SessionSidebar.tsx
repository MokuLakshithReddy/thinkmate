'use client';

import React, { useState } from 'react';
import { ThinkingSession, ThinkingMode, THINKING_MODES } from '@/types';
import { Button } from '@/components/ui/Button';
import {
  Search,
  Plus,
  Archive,
  Trash2,
  Edit2,
  Check,
  X,
  Compass,
  ArchiveRestore,
  Sparkles,
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';

interface SessionSidebarProps {
  isOpen: boolean;
  sessions: ThinkingSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onArchiveSession: (id: string, archive: boolean) => void;
  onDeleteSession: (id: string) => void;
}

export function SessionSidebar({
  isOpen,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
}: SessionSidebarProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  if (!isOpen) return null;

  const filteredSessions = sessions.filter((s) => {
    const matchesFilter = filter === 'archived' ? s.status === 'archived' : s.status !== 'archived';
    const matchesSearch =
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.problemStatement.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleStartRename = (s: ThinkingSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(s.id);
    setEditTitle(s.title);
  };

  const handleSaveRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      onRenameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  return (
    <aside className="w-72 border-r border-slate-800/80 bg-[#090e1a] flex flex-col h-[calc(100vh-3.5rem)] shrink-0 select-none">
      {/* Top Controls */}
      <div className="p-3 border-b border-slate-800/80 space-y-2.5">
        <Button
          variant="primary"
          size="sm"
          onClick={onNewSession}
          className="w-full justify-center text-xs font-semibold"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Thinking Session
        </Button>

        {/* Search */}
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search problems & sessions..."
            className="w-full bg-[#101728] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500/60"
          />
        </div>

        {/* Status Tabs */}
        <div className="flex rounded-md bg-[#101728] p-0.5 border border-slate-800/80 text-xs">
          <button
            onClick={() => setFilter('active')}
            className={cn(
              'flex-1 py-1 rounded text-center font-medium transition-all cursor-pointer',
              filter === 'active'
                ? 'bg-slate-800 text-slate-100 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Active ({sessions.filter((s) => s.status !== 'archived').length})
          </button>
          <button
            onClick={() => setFilter('archived')}
            className={cn(
              'flex-1 py-1 rounded text-center font-medium transition-all cursor-pointer',
              filter === 'archived'
                ? 'bg-slate-800 text-slate-100 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Archived ({sessions.filter((s) => s.status === 'archived').length})
          </button>
        </div>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredSessions.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <Compass className="h-8 w-8 mx-auto text-slate-600 mb-2" />
            <p className="text-xs text-slate-400 font-medium">No sessions found</p>
            <p className="text-[11px] text-slate-500 mt-1">
              {search ? 'Try clearing your search query' : 'Start a session to deconstruct your problem'}
            </p>
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const modeConfig = THINKING_MODES[session.currentMode as ThinkingMode] || THINKING_MODES.understand;

            return (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={cn(
                  'group relative rounded-xl p-2.5 transition-all cursor-pointer border',
                  isActive
                    ? 'bg-[#131d33] border-sky-500/40 shadow-xs'
                    : 'bg-transparent border-transparent hover:bg-[#101728]/70 hover:border-slate-800'
                )}
              >
                {editingId === session.id ? (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 bg-slate-900 border border-sky-500 rounded px-2 py-0.5 text-xs text-slate-100 focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={(e) => handleSaveRename(session.id, e)}
                      className="p-1 hover:text-emerald-400 text-slate-400"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={handleCancelRename} className="p-1 hover:text-rose-400 text-slate-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <h4
                        className={cn(
                          'text-xs font-semibold truncate',
                          isActive ? 'text-sky-300' : 'text-slate-200 group-hover:text-slate-100'
                        )}
                      >
                        {session.title}
                      </h4>

                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.2 rounded border font-medium shrink-0',
                          modeConfig.badgeClass
                        )}
                      >
                        {modeConfig.name}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 line-clamp-1 mb-1.5">
                      {session.problemStatement || 'No initial problem statement'}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>{formatDate(session.updatedAt || session.createdAt)}</span>

                      {/* Action buttons on hover */}
                      <div
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={(e) => handleStartRename(session, e)}
                          title="Rename session"
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        {session.status === 'archived' ? (
                          <button
                            onClick={() => onArchiveSession(session.id, false)}
                            title="Restore session"
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                          >
                            <ArchiveRestore className="h-3 w-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => onArchiveSession(session.id, true)}
                            title="Archive session"
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                          >
                            <Archive className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteSession(session.id)}
                          title="Delete session"
                          className="p-1 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer info */}
      <div className="p-3 border-t border-slate-800/80 bg-[#070b14] text-[11px] text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-sky-400" />
          Stateful Thinking
        </span>
        <span className="text-[10px] text-slate-600 font-mono">v1.0.0</span>
      </div>
    </aside>
  );
}
