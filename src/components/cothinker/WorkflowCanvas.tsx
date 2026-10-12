'use client';

import React, { useState } from 'react';
import { CoThinkerStep, WORKFLOW_STAGES } from '@/types';
import {
  Sparkles,
  Database,
  Plus,
  Minus,
  Maximize2,
  Undo2,
  Redo2,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkflowCanvasProps {
  currentStep: CoThinkerStep;
  isLoading?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function WorkflowCanvas({
  currentStep,
  isLoading,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: WorkflowCanvasProps) {
  const [zoom, setZoom] = useState(100);

  const stepsList: CoThinkerStep[] = [
    'describe_problem',
    'clarify_objective',
    'break_subproblems',
    'explore_perspectives',
    'challenge_assumptions',
    'check_satisfaction',
    'summarize_insights',
    'choose_action',
  ];

  const currentStageInfo = WORKFLOW_STAGES[currentStep];

  return (
    <div className="flex-1 bg-[#f9fafb] relative overflow-hidden flex flex-col justify-center items-center p-6 select-none border-r border-slate-200">
      {/* Subtle Dot Grid Canvas Pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Main Node Card: Co-think Assistant */}
      <div
        className="relative z-10 transition-transform duration-200"
        style={{ transform: `scale(${zoom / 100})` }}
      >
        <div className="w-80 md:w-88 rounded-2xl bg-[#f0f4fa] border-2 border-purple-300 p-5 shadow-lg shadow-purple-900/5 relative">
          {/* Connector handle on top right */}
          <div className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 rounded-full bg-slate-900 border-2 border-white" />

          {/* Card Header: ✦ Co-think Assistant */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-slate-900 font-semibold text-sm flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-purple-600 fill-purple-600" />
                Co-think Assistant
              </span>
            </div>

            {/* Spinner indicator */}
            {isLoading ? (
              <div className="h-4 w-4 rounded-full border-2 border-purple-600 border-t-transparent animate-spin" />
            ) : (
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
            )}
          </div>

          {/* Card Instructions */}
          <p className="text-xs text-slate-700 leading-relaxed font-sans mb-4">
            {currentStageInfo.nodeInstruction}
          </p>

          {/* Used in this step badge */}
          <div className="pt-2 border-t border-purple-200/80 flex items-center justify-between text-[11px] text-slate-500">
            <span>Used in this step</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-purple-200 text-slate-800 font-medium shadow-2xs">
              <Database className="h-3 w-3 text-purple-600" />
              {currentStageInfo.memoryKey || 'Co-Thinker Memory'}
            </span>
          </div>
        </div>

        {/* Visual Flowchart Overview */}
        <div className="mt-6 w-80 md:w-88 bg-white/90 backdrop-blur-xs border border-slate-200 rounded-xl p-3 shadow-xs">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Active Thinking Pipeline</span>
            <span className="text-purple-600 font-mono">
              Step {currentStageInfo.number}/8
            </span>
          </div>

          <div className="space-y-1">
            {stepsList.map((stepKey) => {
              const info = WORKFLOW_STAGES[stepKey];
              const isCurrent = currentStep === stepKey;
              const isPassed = currentStageInfo.number > info.number;

              return (
                <div
                  key={stepKey}
                  className={cn(
                    'flex items-center justify-between px-2.5 py-1 rounded-lg text-[11px] transition-all',
                    isCurrent
                      ? 'bg-purple-100/90 text-purple-900 font-semibold border border-purple-300'
                      : isPassed
                      ? 'bg-slate-50 text-slate-700'
                      : 'text-slate-400'
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-[10px] w-3 text-slate-400">{info.number}.</span>
                    <span className="truncate">{info.label}</span>
                  </div>

                  {isCurrent && (
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-600 animate-pulse shrink-0" />
                  )}
                  {isPassed && (
                    <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Loopback Note */}
          <div className="mt-2 text-[10px] text-slate-500 bg-slate-50 rounded p-1.5 flex items-center gap-1.5">
            <RotateCcw className="h-3 w-3 text-purple-600 shrink-0" />
            <span>If understanding is incomplete at Step 6, workflow loops back to Step 4.</span>
          </div>
        </div>
      </div>

      {/* Canvas Zoom & Controls Bar */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col items-center bg-white border border-slate-200 rounded-lg p-1 shadow-md">
        <button
          onClick={() => setZoom(100)}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
          title="Fit to 100%"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(z + 10, 150))}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
          title="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z - 10, 70))}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
          title="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <div className="w-full h-px bg-slate-200 my-0.5" />
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo to previous step"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo to next step"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
