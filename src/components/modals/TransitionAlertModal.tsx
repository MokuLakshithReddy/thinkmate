'use client';

import React from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ThinkingMode, THINKING_MODES } from '@/types';
import { AlertCircle, ArrowRight, ShieldAlert } from 'lucide-react';

interface TransitionAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetMode: ThinkingMode | null;
  reason: string;
  warning?: string;
  recommendedMode?: ThinkingMode;
  onAcceptRecommended: (mode: ThinkingMode) => void;
  onOverride: (mode: ThinkingMode) => void;
}

export function TransitionAlertModal({
  isOpen,
  onClose,
  targetMode,
  reason,
  warning,
  recommendedMode,
  onAcceptRecommended,
  onOverride,
}: TransitionAlertModalProps) {
  if (!isOpen || !targetMode) return null;

  const targetCfg = THINKING_MODES[targetMode];
  const recCfg = recommendedMode ? THINKING_MODES[recommendedMode] : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Workflow Transition Guardrail"
      description="ThinkMate protects against premature convergence and skipped reasoning phases."
      maxWidth="md"
    >
      <div className="space-y-4">
        <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-xl flex items-start gap-2.5">
          <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <h4 className="font-semibold text-amber-300">Guardrail Triggered</h4>
            <p className="text-slate-300 mt-0.5 leading-relaxed">{reason}</p>
            {warning && <p className="text-slate-400 mt-1 italic">{warning}</p>}
          </div>
        </div>

        {recCfg && (
          <div className="p-3 bg-sky-950/30 border border-sky-800/40 rounded-xl">
            <span className="text-[11px] font-semibold text-sky-400 uppercase tracking-wider block mb-1">
              Recommended Next Phase:
            </span>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-100">{recCfg.name} Mode</span>
                <p className="text-[11px] text-slate-400">{recCfg.tagline}</p>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onAcceptRecommended(recommendedMode!);
                  onClose();
                }}
                className="text-xs h-7"
              >
                Go to {recCfg.name} <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-slate-800">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onOverride(targetMode);
              onClose();
            }}
            className="text-[11px] text-slate-400 hover:text-rose-300"
          >
            Override & force {targetCfg.name}
          </Button>

          <Button size="sm" variant="secondary" onClick={onClose} className="text-xs">
            Stay in Current Mode
          </Button>
        </div>
      </div>
    </Modal>
  );
}
