'use client';

import React from 'react';
import { ThinkingSession, ThinkingMode, THINKING_MODES } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import {
  Brain,
  Plus,
  Compass,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  ListTodo,
  HelpCircle,
  Clock,
  Sparkles,
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';

interface HomeDashboardProps {
  sessions: ThinkingSession[];
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export function HomeDashboard({ sessions, onSelectSession, onNewSession }: HomeDashboardProps) {
  const activeSessions = sessions.filter((s) => s.status !== 'archived').slice(0, 6);

  const modeGuides: { mode: ThinkingMode; icon: React.ReactNode }[] = [
    { mode: 'understand', icon: <HelpCircle className="h-5 w-5" /> },
    { mode: 'explore', icon: <Compass className="h-5 w-5" /> },
    { mode: 'challenge', icon: <ShieldAlert className="h-5 w-5" /> },
    { mode: 'decide', icon: <CheckCircle2 className="h-5 w-5" /> },
    { mode: 'act', icon: <ListTodo className="h-5 w-5" /> },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#090d16] p-6 lg:p-10 select-none">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Hero Section */}
        <div className="rounded-3xl bg-linear-to-b from-[#111828] to-[#0c1220] border border-slate-800/80 p-8 shadow-xl relative overflow-hidden">
          <div className="relative z-10 max-w-2xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-950/80 border border-sky-500/40 text-sky-300 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-sky-400" />
              Collaborative Problem Understanding & Decision Architecture
            </div>

            <h1 className="text-3xl lg:text-4xl font-extrabold text-slate-100 tracking-tight leading-tight">
              Think through hard dilemmas with structured AI co-reasoning.
            </h1>

            <p className="text-sm text-slate-300 leading-relaxed">
              ThinkMate is your personal thinking partner. Rather than giving instant, shallow answers,
              it decomposes fuzzy problems, probes unspoken assumptions, generates distinct options,
              and converts user-approved conclusions into concrete execution roadmaps.
            </p>

            <div className="pt-2 flex items-center gap-3">
              <Button variant="primary" size="lg" onClick={onNewSession} className="text-sm font-semibold shadow-md">
                <Plus className="h-4 w-4 mr-2" />
                Start a New Thinking Session
              </Button>
            </div>
          </div>

          {/* Subtle Decorative Glow */}
          <div className="absolute right-0 top-0 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />
        </div>

        {/* 5 Cognitive Modes Guide */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-100">Adaptive Thinking Workflow</h2>
              <p className="text-xs text-slate-400">
                Move methodically through 5 cognitive modes to prevent premature optimization.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {modeGuides.map(({ mode, icon }) => {
              const cfg = THINKING_MODES[mode];
              return (
                <div
                  key={mode}
                  className="rounded-2xl bg-[#0f172a] border border-slate-800 p-4 flex flex-col justify-between hover:border-slate-700 transition-all shadow-xs"
                >
                  <div className="space-y-2">
                    <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center border', cfg.bgClass, cfg.borderClass, cfg.accentClass)}>
                      {icon}
                    </div>
                    <h3 className="text-xs font-bold text-slate-100">{cfg.name}</h3>
                    <p className="text-[11px] font-medium text-slate-400">{cfg.tagline}</p>
                    <p className="text-[11px] text-slate-500 leading-normal">{cfg.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Sessions */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-100">Recent Thinking Sessions</h2>
              <p className="text-xs text-slate-400">Continue exploring open decisions and hypotheses.</p>
            </div>

            {sessions.length > 0 && (
              <span className="text-xs text-slate-500 font-mono">
                {activeSessions.length} active session{activeSessions.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {activeSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center bg-[#0d1424]/40">
              <Brain className="h-10 w-10 mx-auto text-slate-700 mb-3" />
              <h3 className="text-sm font-semibold text-slate-300">No active thinking sessions</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                Frame your current technical challenge, strategic dilemma, or trade-off to begin.
              </p>
              <Button variant="primary" size="sm" onClick={onNewSession}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create First Session
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeSessions.map((s) => {
                const modeCfg = THINKING_MODES[s.currentMode];
                return (
                  <Card
                    key={s.id}
                    hoverEffect
                    onClick={() => onSelectSession(s.id)}
                    className="cursor-pointer flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full border font-medium',
                            modeCfg.badgeClass
                          )}
                        >
                          {modeCfg.name} Mode
                        </span>
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(s.updatedAt || s.createdAt)}
                        </span>
                      </div>

                      <CardTitle className="text-sm line-clamp-1 mb-1.5">{s.title}</CardTitle>
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {s.problemStatement}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-sky-400 font-medium">
                      <span>Resume thinking</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
