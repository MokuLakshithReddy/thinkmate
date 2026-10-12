'use client';

import React from 'react';
import { Insight, InsightStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import { GitBranch, Check, X, ShieldAlert, ArrowRight, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OptionsMatrixProps {
  options: Insight[];
  onUpdateStatus: (id: string, status: InsightStatus) => void;
  onSelectOption: (option: Insight) => void;
}

export function OptionsMatrix({ options, onUpdateStatus, onSelectOption }: OptionsMatrixProps) {
  if (options.length === 0) return null;

  return (
    <div className="my-4 rounded-2xl bg-[#0d1424] border border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-sky-950/80 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <GitBranch className="h-3.5 w-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
              Comparative Options Matrix
            </h4>
            <p className="text-[11px] text-slate-400">
              Evaluate distinct architectural & strategic alternatives. Select a path to formalize in Decide mode.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {options.map((opt) => {
          const isAccepted = opt.status === 'accepted';
          const isRejected = opt.status === 'rejected';

          return (
            <div
              key={opt.id}
              className={cn(
                'rounded-xl border p-3.5 flex flex-col justify-between transition-all relative',
                isAccepted
                  ? 'bg-emerald-950/20 border-emerald-500/50 shadow-md shadow-emerald-950/30'
                  : isRejected
                  ? 'bg-slate-900/40 border-rose-950/40 opacity-60'
                  : 'bg-[#101728] border-slate-800 hover:border-slate-700'
              )}
            >
              {isAccepted && (
                <div className="absolute -top-2 -right-2 bg-emerald-500 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  Selected
                </div>
              )}

              <div>
                <div className="flex items-start justify-between gap-1 mb-1.5">
                  <h5 className="text-xs font-bold text-slate-100">{opt.title}</h5>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed mb-3">{opt.content}</p>

                {/* Trade-offs */}
                {opt.metadata?.tradeoffs && opt.metadata.tradeoffs.length > 0 && (
                  <div className="mb-2 text-[11px] bg-slate-900/70 rounded-lg p-2 border border-slate-800">
                    <span className="font-semibold text-amber-400 flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" /> Key Trade-offs:
                    </span>
                    <ul className="list-disc list-inside mt-1 space-y-0.5 text-slate-400">
                      {opt.metadata.tradeoffs.map((t: string, idx: number) => (
                        <li key={idx} className="line-clamp-2">
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Risks */}
                {opt.metadata?.risks && opt.metadata.risks.length > 0 && (
                  <div className="mb-3 text-[11px] bg-slate-900/70 rounded-lg p-2 border border-slate-800">
                    <span className="font-semibold text-rose-400">Risks & Blindspots:</span>
                    <ul className="list-disc list-inside mt-1 space-y-0.5 text-slate-400">
                      {opt.metadata.risks.map((r: string, idx: number) => (
                        <li key={idx} className="line-clamp-2">
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 gap-1.5">
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={isAccepted ? 'primary' : 'outline'}
                    onClick={() => onUpdateStatus(opt.id, isAccepted ? 'under_review' : 'accepted')}
                    className={cn(
                      'h-6 text-[10px] px-2',
                      isAccepted && 'bg-emerald-600 border-emerald-500 text-white'
                    )}
                  >
                    <Check className="h-3 w-3 mr-0.5" />
                    {isAccepted ? 'Accepted' : 'Accept'}
                  </Button>
                  <Button
                    size="sm"
                    variant={isRejected ? 'danger' : 'ghost'}
                    onClick={() => onUpdateStatus(opt.id, isRejected ? 'under_review' : 'rejected')}
                    className="h-6 text-[10px] px-2 text-slate-400"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onSelectOption(opt)}
                  className="h-6 text-[10px] px-2 text-sky-300 hover:text-sky-200"
                >
                  Deep Dive <ArrowRight className="h-2.5 w-2.5 ml-1" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
