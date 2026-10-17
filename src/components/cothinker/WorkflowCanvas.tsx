'use client';

import React, { useState } from 'react';
import { CoThinkerStep, WORKFLOW_STAGES, ThinkingMode } from '@/types';
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
  BrainCircuit,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { STAGE_TO_MODE } from '@/services/workflow/state-machine';

interface WorkflowCanvasProps {
  currentStep: CoThinkerStep;
  isLoading?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const MODE_VISUALS: Record<ThinkingMode, { label: string; color: string; badgeBg: string; border: string }> = {
  understand: {
    label: 'Understand',
    color: 'text-indigo-600',
    badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    border: 'border-indigo-400/50',
  },
  explore: {
    label: 'Explore',
    color: 'text-sky-600',
    badgeBg: 'bg-sky-50 text-sky-700 border-sky-200',
    border: 'border-sky-400/50',
  },
  challenge: {
    label: 'Challenge',
    color: 'text-amber-600',
    badgeBg: 'bg-amber-50 text-amber-800 border-amber-200',
    border: 'border-amber-400/50',
  },
  decide: {
    label: 'Decide',
    color: 'text-purple-600',
    badgeBg: 'bg-purple-50 text-purple-700 border-purple-200',
    border: 'border-purple-400/50',
  },
  act: {
    label: 'Act',
    color: 'text-emerald-600',
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    border: 'border-emerald-400/50',
  },
};

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

  // Map step to authoritative thinking mode for dynamic styling
  const getStepMode = (step: CoThinkerStep): { mode: ThinkingMode; label: string; color: string; badgeBg: string; border: string } => {
    const mode = STAGE_TO_MODE[step] || 'understand';
    return {
      mode,
      ...MODE_VISUALS[mode],
    };
  };

  const modeInfo = getStepMode(currentStep);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom((z) => Math.min(z + 10, 150));
    } else if (e.key === '-') {
      e.preventDefault();
      setZoom((z) => Math.max(z - 10, 70));
    } else if (e.key === '0') {
      e.preventDefault();
      setZoom(100);
    }
  };

  return (
    <div
      role="region"
      aria-label="Workflow progress overview"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex-1 bg-gradient-to-b from-slate-50 via-slate-50/80 to-slate-100/60 relative overflow-y-auto overflow-x-hidden flex flex-col items-center justify-start py-8 px-4 sm:px-6 focus:outline-hidden select-none"
    >
      {/* High-Definition Dot Grid Canvas Pattern */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none select-none opacity-30"
        style={{
          backgroundImage: 'radial-gradient(#94a3b8 1.25px, transparent 1.25px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Main Graph Container with smooth Zoom */}
      <div
        className="relative z-10 w-full max-w-md flex flex-col items-center transition-transform duration-200 ease-out"
        style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
      >
        {/* Floating Mode Anchor Pill */}
        <div className="mb-4 inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-xs text-xs font-medium text-slate-700">
          <BrainCircuit className={cn('h-3.5 w-3.5', modeInfo.color)} />
          <span>Active Cognitive Pillar: <strong className={modeInfo.color}>{modeInfo.label}</strong></span>
        </div>

        {/* Primary Node Card: Co-Thinker Assistant Node */}
        <div className={cn(
          'w-full rounded-2xl bg-white/95 backdrop-blur-md border-2 p-5 shadow-lg shadow-slate-900/5 relative select-text transition-all duration-300',
          modeInfo.border
        )}>
          {/* Connector Node Handles */}
          <div aria-hidden="true" className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-slate-900 border-2 border-white shadow-xs" />
          <div aria-hidden="true" className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-purple-600 border-2 border-white shadow-xs" />

          {/* Card Header: ✦ Co-Thinker Assistant Node */}
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-xs shadow-purple-500/20">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-slate-900 font-bold text-sm tracking-tight leading-none">
                  Co-Thinker Assistant Node
                </h2>
                <span className="text-[10px] text-slate-400 font-mono mt-0.5 inline-block">Stage {currentStageInfo.number} of 8</span>
              </div>
            </div>

            {/* Mode & Status indicator */}
            <div className="flex items-center gap-1.5">
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold border shadow-2xs', modeInfo.badgeBg)}>
                {modeInfo.label}
              </span>
              {isLoading ? (
                <div
                  role="status"
                  aria-label="Thinking in progress"
                  className="h-3.5 w-3.5 rounded-full border-2 border-purple-600 border-t-transparent animate-spin shrink-0"
                />
              ) : (
                <span
                  role="status"
                  aria-label="Assistant ready"
                  className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200 shrink-0"
                />
              )}
            </div>
          </div>

          {/* Current Node Stage Label */}
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-800 bg-slate-100/90 px-2.5 py-0.5 rounded-md">
              {currentStageInfo.label}
            </span>
          </div>

          {/* Card Instructions / Persona Directive */}
          <p className="text-xs text-slate-600 leading-relaxed font-sans mb-4 select-text">
            {currentStageInfo.nodeInstruction}
          </p>

          {/* Footer Metadata: Memory Key & Reasoning Pipeline */}
          <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 select-text">
            <span className="font-medium text-slate-400">Context Source</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200/80 text-slate-700 font-medium shadow-2xs">
              <Database className="h-3 w-3 text-purple-600" aria-hidden="true" />
              <span>{currentStageInfo.memoryKey || 'Structured Context'}</span>
            </span>
          </div>
        </div>

        {/* Animated Connector Stem */}
        <div className="h-6 w-0.5 bg-gradient-to-b from-purple-400 to-slate-300 relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-purple-500" />
        </div>

        {/* 8-Stage Interactive Pipeline Stepper */}
        <div className="w-full bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-4 shadow-sm shadow-slate-900/5 select-text">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
            <div className="flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-purple-600" />
              <span id="pipeline-heading" className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Reasoning Flowchart
              </span>
            </div>
            <span className="text-[11px] font-semibold text-purple-700 font-mono bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
              {Math.round((currentStageInfo.number / 8) * 100)}% Complete
            </span>
          </div>

          <div className="space-y-1.5" role="list" aria-labelledby="pipeline-heading">
            {stepsList.map((stepKey) => {
              const info = WORKFLOW_STAGES[stepKey];
              const isCurrent = currentStep === stepKey;
              const isPassed = currentStageInfo.number > info.number;
              const stepMode = getStepMode(stepKey);

              return (
                <div
                  key={stepKey}
                  role="listitem"
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'group flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all select-text border',
                    isCurrent
                      ? 'bg-purple-50/90 text-purple-950 font-semibold border-purple-300 shadow-xs ring-1 ring-purple-200'
                      : isPassed
                      ? 'bg-white text-slate-700 border-slate-200/60 hover:border-slate-300'
                      : 'bg-slate-50/50 text-slate-400 border-transparent'
                  )}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span className={cn(
                      'h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0 transition-colors',
                      isCurrent
                        ? 'bg-purple-600 text-white font-bold shadow-xs'
                        : isPassed
                        ? 'bg-emerald-100 text-emerald-800 font-semibold'
                        : 'bg-slate-200 text-slate-500'
                    )}>
                      {isPassed ? '✓' : info.number}
                    </span>
                    <span className="truncate">{info.label}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn(
                      'text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded text-slate-400 hidden sm:inline-block',
                      isCurrent && stepMode.badgeBg
                    )}>
                      {stepMode.label}
                    </span>

                    {isCurrent && (
                      <span
                        aria-label="Current active step"
                        className="h-2 w-2 rounded-full bg-purple-600 animate-pulse shrink-0"
                      />
                    )}
                    {isPassed && (
                      <CheckCircle2
                        aria-label="Step completed"
                        className="h-3.5 w-3.5 text-emerald-600 shrink-0"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Loopback Note */}
          <div className="mt-3 text-[11px] text-slate-600 bg-amber-50/60 border border-amber-200/80 rounded-xl p-2.5 flex items-center gap-2 select-text">
            <RotateCcw className="h-3.5 w-3.5 text-amber-600 shrink-0" aria-hidden="true" />
            <span>If understanding is incomplete at <strong>Step 6</strong>, the co-thinker loops back to <strong>Step 4</strong> to explore new perspectives.</span>
          </div>
        </div>
      </div>

      {/* Floating Canvas Dock / Toolbar (Bottom Left on Canvas) */}
      <div
        role="toolbar"
        aria-label="Workflow canvas controls"
        className="fixed bottom-6 left-6 z-30 flex items-center gap-1 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl px-2 py-1.5 shadow-lg shadow-slate-900/10 select-none"
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z - 10, 70))}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Zoom out (-)"
          aria-label="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <span className="text-[11px] font-mono font-medium text-slate-600 w-10 text-center">
          {zoom}%
        </span>

        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(z + 10, 150))}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        <button
          type="button"
          onClick={() => setZoom(100)}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Reset zoom to 100% (0)"
          aria-label="Reset zoom"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>

        {(onUndo || onRedo) && (
          <>
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Undo previous step"
              aria-label="Undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Redo next step"
              aria-label="Redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
