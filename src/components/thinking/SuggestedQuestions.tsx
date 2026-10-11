'use client';

import React from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';

interface SuggestedQuestionsProps {
  questions: string[];
  onSelectQuestion: (question: string) => void;
  disabled?: boolean;
}

export function SuggestedQuestions({
  questions,
  onSelectQuestion,
  disabled,
}: SuggestedQuestionsProps) {
  if (!questions || questions.length === 0) return null;

  return (
    <div className="py-2.5 px-4 bg-[#0a0f1d] border-t border-slate-800/80">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-2">
        <Sparkles className="h-3 w-3 text-sky-400" />
        <span>Suggested Probes & Explorations:</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {questions.map((q, idx) => (
          <button
            key={idx}
            disabled={disabled}
            onClick={() => onSelectQuestion(q)}
            className="group flex items-center gap-1.5 text-xs text-slate-300 hover:text-sky-200 bg-[#101728] hover:bg-[#162036] border border-slate-800 hover:border-sky-500/40 rounded-full px-3 py-1.5 transition-all text-left cursor-pointer disabled:opacity-40 disabled:pointer-events-none shadow-xs"
          >
            <span>{q}</span>
            <ArrowRight className="h-2.5 w-2.5 text-slate-500 group-hover:text-sky-400 transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
