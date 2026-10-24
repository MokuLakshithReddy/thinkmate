'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { State } from '@/lib/thinkmate/state';

type Act = 'confirm' | 'reject' | 'edit';

type Props = {
  st: State;
  onItem: (id: string, a: Act, text?: string) => void;
  onFrame: (a: Act, text?: string) => void;
  onDecide?: (ideaId: string) => void;
  onCheckExisting?: (ideaText: string) => void;
};

const badgeClass = (origin: string) =>
  origin === 'user'
    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30';

const verificationClass = (v?: string) => {
  switch (v) {
    case 'supported':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    case 'contradicted':
      return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
    case 'mixed':
      return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
    default:
      return 'bg-slate-800 text-slate-400 border-slate-700';
  }
};

function Card({
  i,
  pending,
  onItem,
  onDecide,
  onCheckExisting,
  linkedCount = 0,
}: {
  i: any;
  pending?: boolean;
  onItem: Props['onItem'];
  onDecide?: Props['onDecide'];
  onCheckExisting?: Props['onCheckExisting'];
  linkedCount?: number;
}) {
  return (
    <motion.div
      layout
      layoutId={i.id}
      initial={{ opacity: 0, y: 25, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 50, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      className={`mb-3 rounded-xl border p-3.5 text-sm shadow-md transition ${
        pending
          ? 'border-amber-500/40 bg-slate-900/90 hover:border-amber-400/60'
          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${badgeClass(i.origin)}`}>
          {i.origin === 'user' ? 'your words' : 'AI suggested'}
        </span>
        <span className="rounded-md px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider bg-slate-800/80 text-slate-400 border border-slate-700/50">
          {i.kind}
        </span>
        {i.verification && (
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium border ${verificationClass(
              i.verification
            )}`}
          >
            {i.verification} ({linkedCount} {linkedCount === 1 ? 'source' : 'sources'})
          </span>
        )}
        {i.kind === 'idea' && (
          <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
            Originality unverified
          </span>
        )}
      </div>

      <p className="text-slate-200 leading-snug">{i.text}</p>

      {/* Warning if claim has fewer than 3 observations */}
      {i.status === 'confirmed' && ['claim', 'hypothesis'].includes(i.kind) && linkedCount < 3 && (
        <p className="mt-1 text-[11px] text-amber-400/80">
          ⚠️ Claim rests on fewer than 3 verified evidence sources
        </p>
      )}

      {/* Pending actions */}
      {pending && (
        <div className="mt-3 flex items-center gap-2 pt-2 border-t border-slate-800/80 text-xs font-semibold">
          <button
            onClick={() => onItem(i.id, 'confirm')}
            className="px-2.5 py-1 rounded-md bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/40 transition"
          >
            Confirm
          </button>
          <button
            onClick={() => {
              const t = window.prompt('Edit item text:', i.text);
              if (t && t.trim() !== i.text) onItem(i.id, 'edit', t.trim());
            }}
            className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition"
          >
            Edit
          </button>
          <button
            onClick={() => onItem(i.id, 'reject')}
            className="px-2.5 py-1 rounded-md bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border border-rose-500/40 transition"
          >
            Reject
          </button>
        </div>
      )}

      {/* Confirmed actions for ideas */}
      {!pending && i.kind === 'idea' && (
        <div className="mt-3 flex items-center gap-2 pt-2 border-t border-slate-800/80 text-xs">
          {onDecide && (
            <button
              onClick={() => onDecide(i.id)}
              className="px-2.5 py-1 rounded-md bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/40 font-semibold transition"
            >
              Finalize Decision
            </button>
          )}
          {onCheckExisting && (
            <button
              onClick={() => onCheckExisting(i.text)}
              className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
            >
              Check existing solutions
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function ThinkingPanel({ st, onItem, onFrame, onDecide, onCheckExisting }: Props) {
  const by = (status: string) => st.items.filter((i: any) => i.status === status);
  const links = (st.links ?? []) as any[];
  const f = st.ws;

  const getLinkedCount = (itemId: string) =>
    links.filter((l) => l.item_id === itemId).length;

  return (
    <aside className="space-y-6 p-5 bg-slate-950/70 border-l border-slate-800 overflow-y-auto h-full text-slate-200">
      {/* Problem Frame Section */}
      <section className="rounded-xl p-4 bg-slate-900/50 border border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm tracking-tight text-slate-100">Problem Frame</h3>
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              f.problem_frame_confirmed
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}
          >
            {f.problem_frame_confirmed ? 'Confirmed' : 'Unconfirmed'}
          </span>
        </div>

        <p className="text-sm text-slate-300 italic">
          {f.problem_frame ? `"${f.problem_frame}"` : 'No confirmed problem frame established yet.'}
        </p>

        {/* Proposed Problem Frame */}
        <AnimatePresence>
          {f.proposed_problem_frame && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mt-3 rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 p-3.5 text-sm"
            >
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 block mb-1">
                AI Proposed Frame:
              </span>
              <p className="text-slate-200">{f.proposed_problem_frame}</p>
              <div className="mt-3 flex gap-2 text-xs font-semibold">
                <button
                  onClick={() => onFrame('confirm')}
                  className="px-2.5 py-1 rounded-md bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/40 transition"
                >
                  Confirm Frame
                </button>
                <button
                  onClick={() => {
                    const t = window.prompt('Edit problem frame:', f.proposed_problem_frame);
                    if (t && t.trim() !== f.proposed_problem_frame) onFrame('edit', t.trim());
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition"
                >
                  Edit
                </button>
                <button
                  onClick={() => onFrame('reject')}
                  className="px-2.5 py-1 rounded-md bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border border-rose-500/40 transition"
                >
                  Reject
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Waiting for Decision Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm tracking-tight text-slate-100 flex items-center gap-2">
            Waiting for Your Decision
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-500/20 text-amber-400 border border-amber-500/30">
              {by('proposed').length}
            </span>
          </h3>
        </div>

        {by('proposed').length === 0 ? (
          <p className="text-xs text-slate-500 italic py-2">
            No pending items. Describe your thoughts or questions to have ThinkMate propose
            structured claims.
          </p>
        ) : (
          <AnimatePresence mode="popLayout">
            {by('proposed').map((item: any) => (
              <Card
                key={item.id}
                i={item}
                pending
                onItem={onItem}
                linkedCount={getLinkedCount(item.id)}
              />
            ))}
          </AnimatePresence>
        )}
      </section>

      {/* Confirmed Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm tracking-tight text-slate-100 flex items-center gap-2">
            Confirmed Claims & Insights
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              {by('confirmed').length}
            </span>
          </h3>
        </div>

        {by('confirmed').length === 0 ? (
          <p className="text-xs text-slate-500 italic py-2">
            Confirmed items fly here when you accept proposals.
          </p>
        ) : (
          <AnimatePresence mode="popLayout">
            {by('confirmed').map((item: any) => (
              <Card
                key={item.id}
                i={item}
                onItem={onItem}
                onDecide={onDecide}
                onCheckExisting={onCheckExisting}
                linkedCount={getLinkedCount(item.id)}
              />
            ))}
          </AnimatePresence>
        )}
      </section>
    </aside>
  );
}
