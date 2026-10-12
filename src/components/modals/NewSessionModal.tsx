'use client';

import React, { useState } from 'react';
import { ThinkingMode, THINKING_MODES } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateSession: (title: string, problemStatement: string, initialMode: ThinkingMode) => void;
}

export function NewSessionModal({ isOpen, onClose, onCreateSession }: NewSessionModalProps) {
  const [title, setTitle] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [initialMode, setInitialMode] = useState<ThinkingMode>('understand');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemStatement.trim()) return;

    setIsSubmitting(true);
    const resolvedTitle =
      title.trim() ||
      (problemStatement.trim().length > 40
        ? problemStatement.trim().slice(0, 37) + '...'
        : problemStatement.trim());

    onCreateSession(resolvedTitle, problemStatement.trim(), initialMode);
    setIsSubmitting(false);
    setTitle('');
    setProblemStatement('');
    setInitialMode('understand');
    onClose();
  };

  const samplePrompts = [
    'Should we rewrite our backend service in Go or optimize our existing Node.js architecture?',
    'How should we structure pricing for our enterprise AI feature without cannibalizing our core tier?',
    'Should I pivot our product toward developers or product managers?',
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Start New Thinking Session"
      description="Frame a complex decision, challenge, or dilemma. ThinkMate will deconstruct your goals and explore options."
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Session Title */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Session Title <span className="text-slate-500 font-normal">(optional, auto-generated if blank)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Backend Architecture Migration"
            className="w-full bg-[#101728] border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        {/* Problem Statement */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Problem Description & Dilemma <span className="text-rose-400">*</span>
          </label>
          <textarea
            required
            rows={4}
            value={problemStatement}
            onChange={(e) => setProblemStatement(e.target.value)}
            placeholder="Describe the situation, tension, or decision. What are you trying to accomplish, and what makes it difficult or risky?"
            className="w-full bg-[#101728] border border-slate-700/80 rounded-xl p-3.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 leading-relaxed"
          />
        </div>

        {/* Quick Sample Prompts */}
        <div>
          <span className="text-[11px] font-medium text-slate-400 mb-1.5 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-sky-400" />
            Or try an example dilemma:
          </span>
          <div className="space-y-1">
            {samplePrompts.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setProblemStatement(prompt);
                  setTitle(prompt.slice(0, 35) + '...');
                }}
                className="w-full text-left text-[11px] text-slate-400 hover:text-sky-300 bg-slate-900/60 hover:bg-slate-800/80 p-2 rounded-lg border border-slate-800/80 transition-colors line-clamp-1 cursor-pointer"
              >
                &ldquo;{prompt}&rdquo;
              </button>
            ))}
          </div>
        </div>

        {/* Starting Mode */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Starting Cognitive Mode</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(['understand', 'explore', 'challenge', 'decide', 'act'] as ThinkingMode[]).map((mode) => {
              const cfg = THINKING_MODES[mode];
              const isSelected = initialMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setInitialMode(mode)}
                  className={cn(
                    'p-2 rounded-xl border text-left transition-all cursor-pointer',
                    isSelected
                      ? `${cfg.bgClass} ${cfg.borderClass} ${cfg.accentClass} ring-1 ring-sky-500/30`
                      : 'bg-[#101728] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  )}
                >
                  <div className="text-xs font-semibold">{cfg.name}</div>
                  <div className="text-[10px] text-slate-500 line-clamp-1">{cfg.tagline}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!problemStatement.trim() || isSubmitting}
            isLoading={isSubmitting}
          >
            Launch Thinking Partner
          </Button>
        </div>
      </form>
    </Modal>
  );
}
