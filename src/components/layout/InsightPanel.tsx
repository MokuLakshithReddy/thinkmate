'use client';

import React, { useState } from 'react';
import { Insight, InsightCategory, InsightStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import {
  Lightbulb,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Layers,
  ShieldAlert,
  GitBranch,
  ListTodo,
  Check,
  X,
  Edit3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface InsightPanelProps {
  isOpen: boolean;
  insights: Insight[];
  onUpdateInsightStatus: (id: string, status: InsightStatus, notes?: string) => void;
  onEditInsight: (id: string, updated: Partial<Insight>) => void;
  onDeleteInsight: (id: string) => void;
}

export function InsightPanel({
  isOpen,
  insights,
  onUpdateInsightStatus,
  onEditInsight,
  onDeleteInsight,
}: InsightPanelProps) {
  const [activeTab, setActiveTab] = useState<InsightCategory | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [userNote, setUserNote] = useState('');

  if (!isOpen) return null;

  const categories: { id: InsightCategory | 'all'; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All', icon: <Layers className="h-3 w-3" /> },
    { id: 'goal', label: 'Goals', icon: <Lightbulb className="h-3 w-3 text-indigo-400" /> },
    { id: 'assumption', label: 'Assumptions', icon: <ShieldAlert className="h-3 w-3 text-amber-400" /> },
    { id: 'option', label: 'Options', icon: <GitBranch className="h-3 w-3 text-sky-400" /> },
    { id: 'decision', label: 'Decisions', icon: <CheckCircle2 className="h-3 w-3 text-emerald-400" /> },
    { id: 'action', label: 'Actions', icon: <ListTodo className="h-3 w-3 text-cyan-400" /> },
    { id: 'uncertainty', label: 'Uncertainties', icon: <HelpCircle className="h-3 w-3 text-purple-400" /> },
  ];

  const filteredInsights = insights.filter((item) =>
    activeTab === 'all' ? true : item.category === activeTab
  );

  const startEdit = (insight: Insight) => {
    setEditingId(insight.id);
    setEditContent(insight.content);
    setUserNote(insight.metadata?.userNotes || '');
  };

  const saveEdit = (id: string) => {
    onEditInsight(id, {
      content: editContent,
      metadata: {
        userNotes: userNote,
      },
    });
    setEditingId(null);
  };

  return (
    <aside className="w-84 md:w-96 border-l border-slate-800/80 bg-[#090e1a] flex flex-col h-[calc(100vh-3.5rem)] shrink-0 select-none">
      {/* Panel Header */}
      <div className="p-3 border-b border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-sky-950/80 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Lightbulb className="h-3.5 w-3.5" />
            </div>
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
              Thinking Artifacts & Insights
            </h3>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60">
            {insights.length}
          </span>
        </div>

        {/* Filter Scrollable Category Bar */}
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => {
            const count =
              cat.id === 'all'
                ? insights.length
                : insights.filter((i) => i.category === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveTab(cat.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 cursor-pointer border',
                  activeTab === cat.id
                    ? 'bg-slate-800 text-slate-100 border-sky-500/40 shadow-xs'
                    : 'bg-[#101728] text-slate-400 border-slate-800 hover:text-slate-200'
                )}
              >
                {cat.icon}
                <span>{cat.label}</span>
                {count > 0 && <span className="text-[9px] opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Insights List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredInsights.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Lightbulb className="h-8 w-8 mx-auto text-slate-700 mb-2" />
            <p className="text-xs text-slate-400 font-medium">No insights yet</p>
            <p className="text-[11px] text-slate-500 mt-1">
              As you discuss your problem, structured goals, assumptions, alternatives, and decisions will appear here.
            </p>
          </div>
        ) : (
          filteredInsights.map((insight) => {
            const isEditing = editingId === insight.id;

            return (
              <div
                key={insight.id}
                className={cn(
                  'rounded-xl border p-3 transition-all',
                  insight.status === 'accepted'
                    ? 'bg-[#0f1d2d] border-emerald-500/40'
                    : insight.status === 'rejected'
                    ? 'bg-[#1a1219] border-rose-900/30 opacity-70'
                    : 'bg-[#111828] border-slate-800'
                )}
              >
                {/* Header: Category Badge & Status */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border',
                        insight.category === 'goal' && 'bg-indigo-950/70 text-indigo-300 border-indigo-700/50',
                        insight.category === 'assumption' && 'bg-amber-950/70 text-amber-300 border-amber-700/50',
                        insight.category === 'option' && 'bg-sky-950/70 text-sky-300 border-sky-700/50',
                        insight.category === 'decision' && 'bg-emerald-950/70 text-emerald-300 border-emerald-700/50',
                        insight.category === 'action' && 'bg-cyan-950/70 text-cyan-300 border-cyan-700/50',
                        insight.category === 'uncertainty' && 'bg-purple-950/70 text-purple-300 border-purple-700/50'
                      )}
                    >
                      {insight.category}
                    </span>

                    {/* Fact vs Assumption Pill */}
                    {insight.category === 'assumption' && (
                      <span
                        className={cn(
                          'text-[9px] px-1.5 py-0.2 rounded border font-medium',
                          insight.metadata?.isFact
                            ? 'bg-blue-950/60 text-blue-300 border-blue-700/50'
                            : 'bg-amber-950/60 text-amber-300 border-amber-700/50'
                        )}
                      >
                        {insight.metadata?.isFact ? 'Fact' : 'Assumption'}
                      </span>
                    )}
                  </div>

                  {/* Accept / Reject Status Controls */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        onUpdateInsightStatus(
                          insight.id,
                          insight.status === 'accepted' ? 'under_review' : 'accepted'
                        )
                      }
                      title="Accept conclusion"
                      className={cn(
                        'p-1 rounded cursor-pointer transition-colors',
                        insight.status === 'accepted'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'text-slate-500 hover:text-emerald-400 hover:bg-slate-800'
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() =>
                        onUpdateInsightStatus(
                          insight.id,
                          insight.status === 'rejected' ? 'under_review' : 'rejected'
                        )
                      }
                      title="Reject conclusion"
                      className={cn(
                        'p-1 rounded cursor-pointer transition-colors',
                        insight.status === 'rejected'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'text-slate-500 hover:text-rose-400 hover:bg-slate-800'
                      )}
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => startEdit(insight)}
                      title="Edit insight"
                      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <h4 className="text-xs font-semibold text-slate-100 mb-1">{insight.title}</h4>

                {/* Content / Editor */}
                {isEditing ? (
                  <div className="space-y-2 mt-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                      rows={3}
                    />
                    <input
                      type="text"
                      placeholder="Add personal note or constraint..."
                      value={userNote}
                      onChange={(e) => setUserNote(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-sky-500"
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-6 text-[11px] px-2">
                        Cancel
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => saveEdit(insight.id)} className="h-6 text-[11px] px-2">
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-300 leading-relaxed">{insight.content}</p>

                    {/* Metadata rendering: Tradeoffs / Risks / User Notes */}
                    {insight.metadata?.tradeoffs && insight.metadata.tradeoffs.length > 0 && (
                      <div className="mt-2 text-[11px] bg-slate-900/60 rounded p-1.5 border border-slate-800/80">
                        <span className="font-semibold text-amber-400">Trade-offs:</span>
                        <ul className="list-disc list-inside mt-0.5 text-slate-400">
                          {insight.metadata.tradeoffs.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {insight.metadata?.risks && insight.metadata.risks.length > 0 && (
                      <div className="mt-1 text-[11px] bg-slate-900/60 rounded p-1.5 border border-slate-800/80">
                        <span className="font-semibold text-rose-400">Risks:</span>
                        <ul className="list-disc list-inside mt-0.5 text-slate-400">
                          {insight.metadata.risks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {insight.metadata?.userNotes && (
                      <div className="mt-1.5 text-[11px] text-sky-300 italic border-l-2 border-sky-500 pl-2">
                        &quot;{insight.metadata.userNotes}&quot;
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="p-2.5 border-t border-slate-800 bg-[#070b14] text-[10px] text-slate-500 text-center">
        Review & approve conclusions before locking in the action plan.
      </div>
    </aside>
  );
}
