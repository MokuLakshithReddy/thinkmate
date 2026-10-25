'use client';

import { useState } from 'react';
import type { State } from '@/lib/thinkmate/state';

const J = { 'Content-Type': 'application/json' };

export function EvidencePanel({
  wsId,
  st,
  onChange,
}: {
  wsId: string;
  st: State;
  onChange: () => void;
}) {
  const [f, setF] = useState({
    kind: 'observation',
    title: '',
    summary: '',
    source_ref: '',
  });
  const [researchQuery, setResearchQuery] = useState('');
  const [researching, setResearching] = useState(false);
  const [researchErr, setResearchErr] = useState('');

  const claims = st.items.filter(
    (i) => i.status === 'confirmed' && ['claim', 'hypothesis'].includes(i.kind)
  );

  const evidence = st.evidence ?? [];
  const links = st.links ?? [];

  async function addEvidence(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim() || !f.summary.trim()) return;

    const res = await fetch(`/api/thinkmate/workspaces/${wsId}/evidence`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify(f),
    });

    if (res.ok) {
      setF({ kind: 'observation', title: '', summary: '', source_ref: '' });
      onChange();
    }
  }

  async function linkEvidence(itemId: string, evidenceId: string, relation: string) {
    await fetch(`/api/thinkmate/items/${itemId}/links`, {
      method: 'PUT',
      headers: J,
      body: JSON.stringify({ evidence_id: evidenceId, relation }),
    });
    onChange();
  }

  async function unlinkEvidence(itemId: string, evidenceId: string) {
    await fetch(`/api/thinkmate/items/${itemId}/links`, {
      method: 'DELETE',
      headers: J,
      body: JSON.stringify({ evidence_id: evidenceId }),
    });
    onChange();
  }

  async function handleResearch(e: React.FormEvent) {
    e.preventDefault();
    const q = researchQuery.trim();
    if (!q || researching) return;

    setResearching(true);
    setResearchErr('');

    try {
      const res = await fetch(`/api/thinkmate/workspaces/${wsId}/research`, {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ question: q }),
      });

      if (res.ok) {
        setResearchQuery('');
        onChange();
      } else {
        const data = await res.json().catch(() => ({}));
        setResearchErr(
          data.error === 'no_sources'
            ? 'No verified web sources could ground this research topic.'
            : data.error === 'research_cap'
            ? 'Research limit reached for this session.'
            : 'Research failed. Please retry.'
        );
      }
    } catch {
      setResearchErr('Network error conducting research.');
    } finally {
      setResearching(false);
    }
  }

  return (
    <div className="space-y-6 p-5 bg-slate-950/70 border-l border-slate-800 text-sm overflow-y-auto h-full text-slate-200">
      {/* Research Grounding Section */}
      <section className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4">
        <h3 className="font-bold text-sm text-sky-300 mb-1 flex items-center gap-2">
          <span>🔍</span> Grounded Web Research
        </h3>
        <p className="text-xs text-slate-400 mb-3 leading-relaxed">
          Search the web with Gemini grounding. Retrieved findings arrive as verified sources
          requiring explicit user evaluation.
        </p>
        <form onSubmit={handleResearch} className="space-y-2">
          <input
            type="text"
            value={researchQuery}
            onChange={(e) => setResearchQuery(e.target.value)}
            placeholder="e.g. Existing solutions for student attendance"
            disabled={researching}
            className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            disabled={researching || !researchQuery.trim()}
            className="w-full py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 text-xs font-semibold transition disabled:opacity-50"
          >
            {researching ? 'Researching with Google Search...' : 'Run Grounded Research'}
          </button>
          {researchErr && <p className="text-xs text-rose-400 mt-1">{researchErr}</p>}
        </form>
      </section>

      {/* Manual Evidence Recording */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="font-bold text-sm text-slate-200 mb-2">Record Evidence / Observation</h3>
        <form onSubmit={addEvidence} className="space-y-2.5">
          <select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            {[
              'observation',
              'interview',
              'document',
              'dataset',
              'experiment',
              'web_source',
            ].map((k) => (
              <option key={k} value={k}>
                {k.replace('_', ' ')}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder="Evidence title / stakeholder"
            className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          <textarea
            value={f.summary}
            onChange={(e) => setF({ ...f, summary: e.target.value })}
            rows={2}
            placeholder="What was observed or learned? (Include sample size, limits)"
            className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            disabled={!f.title.trim() || !f.summary.trim()}
            className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition disabled:opacity-50"
          >
            Add Evidence
          </button>
        </form>
      </section>

      {/* Recorded Evidence List */}
      <section className="space-y-3">
        <h3 className="font-bold text-sm text-slate-200">
          Recorded Evidence ({evidence.length})
        </h3>
        {evidence.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No evidence recorded yet.</p>
        ) : (
          evidence.map((ev) => (
            <div key={ev.id} className="p-3 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">{ev.title}</span>
                <span className="px-2 py-0.5 rounded-md text-[10px] bg-slate-800 text-slate-400 uppercase tracking-wider">
                  {ev.kind}
                </span>
              </div>
              <p className="text-xs text-slate-400">{ev.summary}</p>
              {ev.source_ref && (
                <a
                  href={ev.source_ref}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[11px] text-sky-400 hover:underline truncate"
                >
                  🔗 {ev.source_ref}
                </a>
              )}

              {/* Linking to Confirmed Claims */}
              {claims.length > 0 && (
                <div className="pt-2 border-t border-slate-800 text-[11px] space-y-1.5">
                  <span className="text-slate-500 font-medium block">Link to Claims:</span>
                  {claims.map((c) => {
                    const existingLink = links.find(
                      (l) => l.item_id === c.id && l.evidence_id === ev.id
                    );
                    return (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-1 py-1">
                        <span className="truncate max-w-[160px] text-slate-300">&quot;{c.text}&quot;</span>
                        <div className="flex items-center gap-1">
                          {existingLink ? (
                            <button
                              onClick={() => unlinkEvidence(c.id, ev.id)}
                              className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px]"
                            >
                              Unlink ({existingLink.relation})
                            </button>
                          ) : (
                            ['supports', 'contradicts', 'context'].map((r) => (
                              <button
                                key={r}
                                onClick={() => linkEvidence(c.id, ev.id, r)}
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px]"
                              >
                                {r}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
