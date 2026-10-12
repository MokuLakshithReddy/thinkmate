'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ShieldCheck, Database, Trash2, Cpu, Check, Lock, AlertTriangle } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClearAllData: (options?: { wipeCloud?: boolean }) => void | Promise<void>;
}

export function SettingsModal({ isOpen, onClose, onClearAllData }: SettingsModalProps) {
  const [authToken, setAuthToken] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('thinkmate_auth_token') || '';
    }
    return '';
  });
  const [model, setModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('thinkmate_model') || 'gemini-2.5-flash';
    }
    return 'gemini-2.5-flash';
  });
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<'local' | 'all' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      if (authToken.trim()) {
        localStorage.setItem('thinkmate_auth_token', authToken.trim());
      } else {
        localStorage.removeItem('thinkmate_auth_token');
      }
      localStorage.setItem('thinkmate_model', model);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleClearLocal = async () => {
    setIsDeleting(true);
    setWipeError(null);
    try {
      await onClearAllData({ wipeCloud: false });
      setConfirmDelete(null);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleWipeAll = async () => {
    setIsDeleting(true);
    setWipeError(null);

    let cloudDeleteSucceeded = false;
    let localDeleteSucceeded = false;

    // Step 1: Attempt cloud deletion and verify the response
    if (authToken.trim()) {
      try {
        const response = await fetch('/api/sessions?all=true', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken.trim()}` },
        });

        if (response.ok) {
          cloudDeleteSucceeded = true;
        } else {
          // Read server error message for actionable feedback
          const errorBody = await response.json().catch(() => ({}));
          const serverMessage = errorBody.error || `Server returned status ${response.status}`;
          setWipeError(`Cloud deletion failed: ${serverMessage}. Your cloud sessions are still intact. Please try again or check your connection.`);
          setIsDeleting(false);
          // Do NOT clear local state or close modal — retain everything
          return;
        }
      } catch (networkErr) {
        setWipeError(
          'Cloud deletion failed: unable to reach the server. Your cloud sessions and local data have not been modified. Please check your network connection and try again.'
        );
        setIsDeleting(false);
        return;
      }
    } else {
      // No auth token — no cloud data to delete, skip
      cloudDeleteSucceeded = true;
    }

    // Step 2: Clear local state only after cloud deletion confirms
    try {
      await onClearAllData({ wipeCloud: true });
      localDeleteSucceeded = true;
    } catch (localErr) {
      console.error('Local data clear failed:', localErr);
      setWipeError(
        'Cloud sessions were deleted, but clearing local data failed. Please try clearing browser storage manually.'
      );
      setIsDeleting(false);
      return;
    }

    // Step 3: Full success — clear credentials and close
    if (cloudDeleteSucceeded && localDeleteSucceeded) {
      setAuthToken('');
      setConfirmDelete(null);
      setWipeError(null);
      onClose();
    }

    setIsDeleting(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings & Authentication"
      description="Configure your Gemini model, credentials, and data retention preferences."
      maxWidth="md"
    >
      <div className="space-y-5">
        {/* Model Architecture */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-sky-400" />
            Gemini Model Architecture
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-[#101728] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended: Fast & Deep Reasoning)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep Multi-Hop Synthesis)</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Standard Latency)</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            Official Google GenAI SDK (`@google/genai`) with server-managed credentials.
          </p>
        </div>

        {/* Supabase Bearer Auth Token */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-sky-400" />
            Supabase Bearer Token <span className="text-slate-500 font-normal">(For Authenticated Cloud Sessions)</span>
          </label>
          <input
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="eyJhbGciOi... (Leave empty for interactive demo simulator)"
            className="w-full bg-[#101728] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
          />
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>AI endpoints strictly require verified authentication to access private cloud sessions.</span>
          </div>
        </div>

        {/* Server-Side Key Management Architecture Note */}
        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex items-start gap-3">
          <Database className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-semibold text-slate-200">Server-Side Security & Key Policy</span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Gemini API keys are managed exclusively on the server to prevent credential leakage and model relaying. Unauthenticated traffic runs within an isolated sandbox.
            </p>
          </div>
        </div>

        {/* Wipe Error Banner */}
        {wipeError && (
          <div className="p-3 bg-rose-950/50 rounded-xl border border-rose-800/60 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-300">
              <span className="font-semibold block mb-0.5">Data Wipe Error</span>
              <p className="text-[11px] text-rose-400/90">{wipeError}</p>
            </div>
          </div>
        )}

        {/* Save Settings */}
        <div className="flex items-center justify-between pt-2">
          <Button variant="primary" size="sm" onClick={handleSave} className="text-xs">
            {savedSuccess ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1 text-emerald-300" />
                Settings Saved
              </>
            ) : (
              'Save Preferences'
            )}
          </Button>

          {/* Data Cleanup Actions */}
          <div className="flex items-center gap-2">
            {confirmDelete === 'local' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-amber-400">Clear offline drafts?</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleClearLocal}
                  disabled={isDeleting}
                  className="h-7 text-xs bg-amber-600 hover:bg-amber-500"
                >
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setConfirmDelete(null); setWipeError(null); }}
                  disabled={isDeleting}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : confirmDelete === 'all' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-rose-400">Permanently wipe cloud & local?</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleWipeAll}
                  disabled={isDeleting}
                  className="h-7 text-xs"
                >
                  {isDeleting ? 'Wiping...' : 'Yes, Wipe All'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setConfirmDelete(null); setWipeError(null); }}
                  disabled={isDeleting}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setConfirmDelete('local'); setWipeError(null); }}
                  className="text-xs text-slate-400 hover:text-slate-200"
                  title="Remove local draft sessions and cached browser data"
                >
                  Clear Local Drafts
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => { setConfirmDelete('all'); setWipeError(null); }}
                  className="text-xs"
                  title="Permanently delete all cloud sessions from Supabase and clear local credentials"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Wipe All Data
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
