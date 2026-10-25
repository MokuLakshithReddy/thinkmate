'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type { State } from '@/lib/thinkmate/state';
import { ThinkingPanel } from './ThinkingPanel';
import { EvidencePanel } from './EvidencePanel';
import { STAGES, suggestStage, type Stage, type Counts } from '@/lib/thinkmate/stages';

const MODES = [
  ['guide', 'Guide me'],
  ['balanced', 'Balanced'],
  ['ideas', 'Give me ideas'],
] as const;

const J = { 'Content-Type': 'application/json' };

export default function Workspace({
  initial,
  features = { stages: true, evidence: false },
}: {
  initial: State;
  features?: { stages?: boolean; evidence?: boolean };
}) {
  const [st, setSt] = useState<State>(initial);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(0);
  const [activeTab, setActiveTab] = useState<'thinking' | 'evidence'>('thinking');
  const [sheetOpen, setSheetOpen] = useState(false);
  const pendingId = useRef<{ text: string; id: string } | null>(null);

  // Decision Modal State
  const [decisionIdeaId, setDecisionIdeaId] = useState<string | null>(null);
  const [decisionRationale, setDecisionRationale] = useState('');
  const [decisionRejectedIds, setDecisionRejectedIds] = useState<string[]>([]);
  const [decisionReconsiderIf, setDecisionReconsiderIf] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const base = `/api/thinkmate/workspaces/${st.ws.id}`;
  const post = (path: string, body: object) =>
    fetch(base + path, { method: 'POST', headers: J, body: JSON.stringify(body) });

  // Refetch full state
  const refetch = async () => {
    try {
      const res = await fetch(base);
      if (res.ok) {
        const updated = await res.json();
        setSt(updated);
      }
    } catch {}
  };

  useEffect(() => {
    fetch(`${base}/events`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ type: 'session_start' }),
    }).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [base]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [st.messages]);

  const mins = now > 0 ? Math.max(0, Math.floor((now - Date.parse(st.ws.created_at)) / 60000)) : 0;

  // Compute counts for stage suggestion
  const confirmedItems = st.items.filter((i) => i.status === 'confirmed');
  const counts: Counts = {
    hasMessages: st.messages.length > 0,
    frameConfirmed: Boolean(st.ws.problem_frame_confirmed),
    claims: confirmedItems.filter((i) => i.kind === 'claim').length,
    hypotheses: confirmedItems.filter((i) => i.kind === 'hypothesis').length,
    ideas: confirmedItems.filter((i) => i.kind === 'idea').length,
    counterarguments: confirmedItems.filter((i) => i.kind === 'counterargument').length,
    experiments: confirmedItems.filter((i) => i.kind === 'experiment').length,
    evidenceLinked: (st.links ?? []).length,
    decided: (st.decisions ?? []).length > 0,
  };

  const suggested = suggestStage(counts);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    // Retain client_msg_id on retry if text hasn't changed (Idempotency)
    if (!pendingId.current || pendingId.current.text !== text) {
      pendingId.current = { text, id: crypto.randomUUID() };
    }
    const clientMsgId = pendingId.current.id;

    setBusy(true);
    setErr('');

    try {
      const res = await post('/turn', { message: text, client_msg_id: clientMsgId });
      if (res.ok) {
        const data = await res.json();
        setSt(data);
        setInput('');
        pendingId.current = null; // Reset on success
      } else {
        const data = await res.json().catch(() => ({}));
        setErr(
          data.error === 'daily_cap'
            ? 'Daily message limit reached (300 turns). Try again tomorrow.'
            : data.error === 'turn_cap'
            ? 'Session limit reached (160 turns). Please start a new workspace.'
            : 'ThinkMate could not answer. Your text is kept, try again.'
        );
      }
    } catch {
      setErr('Connection error. Please retry sending your message.');
    } finally {
      setBusy(false);
    }
  }

  async function item(id: string, action: string, text?: string) {
    const res = await fetch(`/api/thinkmate/items/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ action, text }),
    });
    if (res.ok) {
      const u = await res.json();
      setSt((s) => ({
        ...s,
        items: s.items.map((i) => (i.id === u.id ? u : i)),
      }));
    }
  }

  async function frame(action: string, text?: string) {
    const res = await fetch(`${base}/frame`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        action,
        text,
        expected_updated_at: st.ws.updated_at,
      }),
    });
    if (res.ok) {
      const ws = await res.json();
      setSt((s) => ({ ...s, ws }));
    } else if (res.status === 409) {
      alert('Problem frame was updated by another session. Refetching latest.');
      refetch();
    }
  }

  async function setMode(mode: 'guide' | 'balanced' | 'ideas') {
    await post('/events', { type: 'mode_changed', payload: { mode } });
    setSt((s) => ({ ...s, ws: { ...s.ws, mode } }));
  }

  async function setStage(stage: Stage) {
    const res = await fetch(`${base}/stage`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ stage }),
    });
    if (res.ok) {
      const ws = await res.json();
      setSt((s) => ({ ...s, ws }));
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to permanently delete this workspace?')) return;
    const res = await fetch(base, { method: 'DELETE' });
    if (res.ok) {
      router.push('/thinkmate');
    } else {
      alert('Could not delete workspace.');
    }
  }

  async function handleExport() {
    window.open(`${base}/export`, '_blank');
  }

  async function submitDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!decisionIdeaId || !decisionRationale.trim() || decisionSubmitting) return;

    setDecisionSubmitting(true);
    try {
      const res = await fetch(`${base}/decisions`, {
        method: 'POST',
        headers: J,
        body: JSON.stringify({
          selected_item_id: decisionIdeaId,
          rationale: decisionRationale.trim(),
          rejected_item_ids: decisionRejectedIds,
          reconsider_if: decisionReconsiderIf.trim() || undefined,
        }),
      });

      if (res.ok) {
        setDecisionIdeaId(null);
        setDecisionRationale('');
        setDecisionRejectedIds([]);
        setDecisionReconsiderIf('');
        refetch();
      } else {
        alert('Could not record decision. Make sure rationale is at least 10 characters.');
      }
    } finally {
      setDecisionSubmitting(false);
    }
  }

  const pendingCount = st.items.filter((i) => i.status === 'proposed').length;
  const confirmedCount = confirmedItems.length;

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1fr_420px] bg-slate-950 text-slate-100">
      {/* Left Chat & Workflow Column */}
      <main className="flex flex-col h-screen overflow-hidden border-r border-slate-800">
        {/* Navigation & Controls Bar */}
        <header className="p-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link
                href="/thinkmate"
                className="text-slate-400 hover:text-white text-xs font-semibold px-2 py-1 rounded bg-slate-800"
              >
                ← All Workspaces
              </Link>
              <h2 className="font-bold text-sm text-slate-100 truncate max-w-[280px]">
                {st.ws.title}
              </h2>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-mono">{mins}m</span>
              <button
                onClick={handleExport}
                className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              >
                Export .md
              </button>
              <button
                onClick={() => {
                  if (confirm('End and abandon this session?')) {
                    post('/events', { type: 'abandon' });
                    router.push('/thinkmate');
                  }
                }}
                className="px-2.5 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition"
              >
                Stop
              </button>
              <button
                onClick={handleDelete}
                className="px-2 py-1 rounded-md text-slate-500 hover:text-rose-400 text-xs"
                title="Delete Workspace"
              >
                🗑
              </button>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 mr-1 uppercase tracking-wider font-semibold">
                Mode:
              </span>
              {MODES.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setMode(k)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    st.ws.mode === k
                      ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Mobile Tab Toggle */}
            <div className="flex lg:hidden rounded-lg bg-slate-800 p-0.5 text-xs">
              <button
                onClick={() => {
                  setActiveTab('thinking');
                  setSheetOpen(true);
                }}
                className={`px-3 py-1 rounded-md ${
                  activeTab === 'thinking' ? 'bg-sky-500 text-white' : 'text-slate-400'
                }`}
              >
                Thinking ({pendingCount})
              </button>
              {features.evidence && (
                <button
                  onClick={() => {
                    setActiveTab('evidence');
                    setSheetOpen(true);
                  }}
                  className={`px-3 py-1 rounded-md ${
                    activeTab === 'evidence' ? 'bg-sky-500 text-white' : 'text-slate-400'
                  }`}
                >
                  Evidence
                </button>
              )}
            </div>
          </div>

          {/* 8-Stage Workflow Bar */}
          {features.stages && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 font-medium">Stage Progress</span>
                {suggested !== st.ws.stage && (
                  <button
                    onClick={() => setStage(suggested)}
                    className="text-sky-400 hover:text-sky-300 font-semibold underline flex items-center gap-1"
                  >
                    Suggest moving to: <span className="uppercase">{suggested}</span> →
                  </button>
                )}
              </div>
              <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
                {STAGES.map((s) => {
                  const isCurrent = st.ws.stage === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setStage(s)}
                      className={`relative px-2.5 py-1 rounded-lg text-[11px] font-medium uppercase tracking-wider transition ${
                        isCurrent
                          ? 'text-sky-300 bg-sky-950/80 border border-sky-500/50'
                          : 'text-slate-500 hover:text-slate-300 bg-slate-900/40 border border-slate-800/60'
                      }`}
                    >
                      {isCurrent && (
                        <motion.div
                          layoutId="active-stage"
                          className="absolute inset-0 rounded-lg bg-sky-500/20"
                          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        />
                      )}
                      <span className="relative z-10">{s}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </header>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {st.messages.length > 0 && (
            <div className="rounded-lg bg-slate-900/60 border border-slate-800 p-2.5 text-xs text-slate-400 flex items-center justify-between">
              <span>
                State: <strong className="text-emerald-400">{confirmedCount}</strong> confirmed,{' '}
                <strong className="text-amber-400">{pendingCount}</strong> waiting for your decision.
              </span>
              <span className="text-[11px] text-slate-500">
                {st.messages.length} / 160 turns
              </span>
            </div>
          )}

          {st.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500 space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 flex items-center justify-center text-2xl text-sky-400 border border-sky-500/30">
                💡
              </div>
              <h3 className="text-base font-bold text-slate-200">Welcome to your thinking space</h3>
              <p className="text-xs max-w-sm text-slate-400 leading-relaxed">
                Describe the problem or context in your own words. ThinkMate will ask focused
                questions, extract claims for your confirmation, and help you defend your solution.
              </p>
            </div>
          ) : (
            st.messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <div
                  key={m.id || m.seq}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl p-4 text-sm shadow-md leading-relaxed ${
                      isUser
                        ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white rounded-br-none'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'
                    }`}
                  >
                    {!isUser && m.guidance_mode && (
                      <span className="inline-block mb-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-sky-400 border border-slate-700/60">
                        {m.guidance_mode}
                      </span>
                    )}
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              );
            })
          )}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-sky-400 italic">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
              ThinkMate is analyzing context and framing next questions...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <footer className="p-4 border-t border-slate-800 bg-slate-900/40">
          {err && <p className="mb-2 text-xs text-rose-400 font-medium">{err}</p>}
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              disabled={busy}
              placeholder="Describe your thinking, provide evidence, or ask a question... (Ctrl+Enter to send)"
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition resize-none"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="px-5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm transition shadow-lg shadow-sky-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[80px]"
            >
              {busy ? '...' : 'Send'}
            </button>
          </div>
        </footer>
      </main>

      {/* Right Column: Desktop Tabs & Panels / Mobile Sheet */}
      <aside
        className={`${
          sheetOpen ? 'fixed inset-0 z-40 flex bg-slate-950' : 'hidden'
        } lg:static lg:z-auto lg:flex flex-col h-screen overflow-hidden`}
      >
        <button
          className="lg:hidden self-end m-3 text-xs text-slate-300 underline"
          onClick={() => setSheetOpen(false)}
        >
          Close
        </button>
        <div className="flex border-b border-slate-800 bg-slate-900/60 px-4 pt-3 gap-2">
          <button
            onClick={() => setActiveTab('thinking')}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition border-t border-x ${
              activeTab === 'thinking'
                ? 'bg-slate-950 text-sky-400 border-slate-800'
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            Thinking Cards ({pendingCount})
          </button>
          {features.evidence && (
            <button
              onClick={() => setActiveTab('evidence')}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition border-t border-x ${
                activeTab === 'evidence'
                  ? 'bg-slate-950 text-sky-400 border-slate-800'
                  : 'text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              Evidence & Research
            </button>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'thinking' || !features.evidence ? (
            <ThinkingPanel
              st={st}
              onItem={item}
              onFrame={frame}
              onDecide={features.stages ? (ideaId) => setDecisionIdeaId(ideaId) : undefined}
              onCheckExisting={() => {
                if (features.evidence) setActiveTab('evidence');
              }}
            />
          ) : (
            <EvidencePanel wsId={st.ws.id} st={st} onChange={refetch} />
          )}
        </div>
      </aside>

      {/* Decision Dialog Modal */}
      {decisionIdeaId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">Finalize Decision on Idea</h3>
            <p className="text-xs text-slate-400">
              Selected Idea:{' '}
              <strong className="text-slate-200">
                &quot;{st.items.find((i) => i.id === decisionIdeaId)?.text}&quot;
              </strong>
            </p>

            <form onSubmit={submitDecision} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Rationale (Why this idea beat alternatives, min 10 chars) *
                </label>
                <textarea
                  value={decisionRationale}
                  onChange={(e) => setDecisionRationale(e.target.value)}
                  rows={3}
                  required
                  placeholder="State the core reason this solution fits constraints and evidence better than alternatives..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  What evidence or finding would make you reconsider this choice?
                </label>
                <input
                  type="text"
                  value={decisionReconsiderIf}
                  onChange={(e) => setDecisionReconsiderIf(e.target.value)}
                  placeholder="e.g. If user surveys show less than 20% interest in automated notifications"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Rejected Ideas Checkboxes */}
              {st.items.filter((i) => i.kind === 'idea' && i.id !== decisionIdeaId).length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Select other candidate ideas rejected in favor of this:
                  </label>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {st.items
                      .filter((i) => i.kind === 'idea' && i.id !== decisionIdeaId)
                      .map((alt) => (
                        <label
                          key={alt.id}
                          className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={decisionRejectedIds.includes(alt.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setDecisionRejectedIds([...decisionRejectedIds, alt.id]);
                              } else {
                                setDecisionRejectedIds(
                                  decisionRejectedIds.filter((id) => id !== alt.id)
                                );
                              }
                            }}
                            className="rounded border-slate-700 bg-slate-950"
                          />
                          <span className="truncate">{alt.text}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDecisionIdeaId(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={decisionRationale.trim().length < 10 || decisionSubmitting}
                  className="px-4 py-2 rounded-lg bg-sky-500 text-white text-xs font-semibold hover:bg-sky-400 disabled:opacity-50"
                >
                  {decisionSubmitting ? 'Recording...' : 'Record Final Decision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
