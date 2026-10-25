'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/thinkmate/api-client';

interface InviteModalProps {
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function InviteModal({ workspaceId, isOpen, onClose }: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);

  if (!isOpen) return null;

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInviteUrl(null);
    setNeedsUpgrade(false);

    try {
      const res = await apiFetch(`/api/thinkmate/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && data.error === 'team_plan_required') {
          setNeedsUpgrade(true);
        }
        setError(data.message || data.error || 'Failed to create invite');
        return;
      }

      setInviteUrl(data.invite_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Invite Collaborator</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        {needsUpgrade ? (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs leading-relaxed">
              <strong>Team Plan Required:</strong> Shared workspaces and collaborator invitations are available on the Team plan.
            </div>
            <Link
              href="/pricing"
              className="block w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm text-center transition-colors shadow-lg shadow-indigo-600/20"
            >
              Upgrade to Team Plan
            </Link>
          </div>
        ) : inviteUrl ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-300">
              Invitation link generated! Send this link to <span className="font-semibold text-white">{email}</span>:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shrink-0 transition"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => {
                setInviteUrl(null);
                setEmail('');
              }}
              className="w-full py-2 text-xs text-slate-400 hover:text-slate-200 transition"
            >
              Invite another collaborator
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreateInvite} className="space-y-4">
            {error && (
              <div className="p-3 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Collaborator Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="w-full rounded-xl bg-slate-800/80 border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
                className="w-full rounded-xl bg-slate-800/80 border border-slate-700/80 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition"
              >
                <option value="editor">Editor (Can add thoughts, frames, decisions)</option>
                <option value="viewer">Viewer (Read-only access)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm transition-colors shadow-lg shadow-indigo-600/20"
            >
              {loading ? 'Creating Invitation...' : 'Generate Invite Link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
