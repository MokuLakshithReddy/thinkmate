'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateWorkspaceForm() {
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || loading) return;

    setLoading(true);
    try {
      const res = await fetch('/api/thinkmate/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanTitle }),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/thinkmate/${data.id}`);
      } else {
        alert('Failed to initialize workspace. Please try again.');
      }
    } catch {
      alert('Network error initializing workspace.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Why do college students miss morning workshops?"
        disabled={loading}
        className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition"
      />
      <button
        type="submit"
        disabled={loading || !title.trim()}
        className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-sm transition shadow-lg shadow-sky-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[140px]"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Creating...
          </span>
        ) : (
          'Start Session →'
        )}
      </button>
    </form>
  );
}
