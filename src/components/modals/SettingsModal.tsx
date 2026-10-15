'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ShieldCheck, Database, Trash2, Cpu, Check, Lock, AlertTriangle, KeyRound } from 'lucide-react';
import {
  SUPPORTED_GEMINI_MODELS,
  GEMINI_MODEL_METADATA,
  DEFAULT_GEMINI_MODEL,
  SupportedGeminiModel,
  isValidModel,
} from '@/config/models';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClearAllData: (options?: { wipeCloud?: boolean }) => void | Promise<void>;
}

export function SettingsModal({ isOpen, onClose, onClearAllData }: SettingsModalProps) {
  const [model, setModel] = useState<SupportedGeminiModel>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('thinkmate_model');
      if (stored && isValidModel(stored)) {
        return stored;
      }
    }
    return DEFAULT_GEMINI_MODEL;
  });

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<'local' | 'all' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  // Security Hardening: On mount, detect and purge any legacy bearer tokens from localStorage
  // to prevent credential exposure via XSS.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const legacyToken = localStorage.getItem('thinkmate_auth_token');
      if (legacyToken) {
        localStorage.removeItem('thinkmate_auth_token');
        console.info('[Security] Purged legacy bearer token from browser localStorage. Authentication is now strictly server-managed via HttpOnly cookies.');
      }
    }
  }, []);

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('thinkmate_model', model);
      // Ensure no legacy token is retained
      localStorage.removeItem('thinkmate_auth_token');
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

    // Step 1: Attempt server-side cloud deletion using secure ambient cookie credentials
    try {
      const response = await fetch('/api/sessions?all=true', {
        method: 'DELETE',
        credentials: 'same-origin',
      });

      if (response.ok) {
        cloudDeleteSucceeded = true;
      } else if (response.status === 401) {
        // Not authenticated in cloud — local data only
        cloudDeleteSucceeded = true;
      } else {
        // Read server error message for actionable feedback
        const errorBody = await response.json().catch(() => ({}));
        const serverMessage = errorBody.error || `Server returned status ${response.status}`;
        setWipeError(
          `Cloud deletion failed: ${serverMessage}. Your cloud sessions are still intact. Please try again or check your connection.`
        );
        setIsDeleting(false);
        return;
      }
    } catch {
      setWipeError(
        'Cloud deletion failed: unable to reach the server. Your cloud sessions and local data have not been modified. Please check your network connection and try again.'
      );
      setIsDeleting(false);
      return;
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

    // Step 3: Full success — cleanup and close
    if (cloudDeleteSucceeded && localDeleteSucceeded) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('thinkmate_auth_token');
      }
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
      title="Settings & Reasoning Configuration"
      description="Configure your active Gemini reasoning model and data retention preferences."
      maxWidth="md"
    >
      <div className="space-y-5">
        {/* Model Architecture */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-sky-400" />
            Gemini Reasoning Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as SupportedGeminiModel)}
            className="w-full bg-[#101728] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            {SUPPORTED_GEMINI_MODELS.map((mId) => {
              const meta = GEMINI_MODEL_METADATA[mId];
              return (
                <option key={mId} value={mId}>
                  {meta.name} ({meta.tagline})
                </option>
              );
            })}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            {GEMINI_MODEL_METADATA[model]?.description || 'Official Google GenAI SDK (`@google/genai`) with server-managed credentials.'}
          </p>
        </div>

        {/* Server-Managed Authentication & Cookie Security */}
        <div className="p-3.5 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-200">Server-Managed Authentication</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            ThinkMate strictly protects user credentials by utilizing secure, server-managed{' '}
            <code className="text-emerald-300 font-mono text-[10px]">HttpOnly, SameSite=Lax, Secure</code> cookies.
            Bearer tokens are never stored in browser <code className="text-slate-300 font-mono text-[10px]">localStorage</code>,
            preventing token extraction via Cross-Site Scripting (XSS).
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-0.5">
            <Lock className="h-3 w-3 text-sky-400" />
            <span>Cloud session requests automatically authenticate via Same-Origin credentials.</span>
          </div>
        </div>

        {/* Server-Side Key Management Architecture Note */}
        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex items-start gap-3">
          <Database className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-semibold text-slate-200">Server-Side Security & Key Policy</span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Gemini API keys are managed exclusively on the server to prevent credential leakage and model relaying. Unauthenticated demo traffic runs within an isolated sandbox.
            </p>
          </div>
        </div>

        {/* Data Management Section */}
        <div className="pt-3 border-t border-slate-800">
          <h4 className="text-xs font-semibold text-slate-300 mb-2.5 flex items-center gap-1.5">
            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            Data Retention & Deletion
          </h4>

          {wipeError && (
            <div className="p-2.5 mb-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2 text-rose-400 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{wipeError}</span>
            </div>
          )}

          {confirmDelete === null ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete('local')}
                className="w-full text-xs border-slate-700/80 hover:bg-slate-800 text-slate-300"
              >
                Clear Local Cache Only
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmDelete('all')}
                className="w-full text-xs"
              >
                Wipe All Data (Cloud & Local)
              </Button>
            </div>
          ) : confirmDelete === 'local' ? (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
              <p className="text-xs text-amber-300">
                Are you sure? This will remove all locally cached drafts and history on this device. Cloud-backed sessions remain unaffected.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(null)}
                  disabled={isDeleting}
                  className="text-xs border-slate-700"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleClearLocal}
                  disabled={isDeleting}
                  className="text-xs"
                >
                  {isDeleting ? 'Clearing...' : 'Confirm Clear Local'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl space-y-2">
              <p className="text-xs text-rose-300">
                Are you sure you want to permanently delete all cloud sessions and local data? This action cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(null)}
                  disabled={isDeleting}
                  className="text-xs border-slate-700"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleWipeAll}
                  disabled={isDeleting}
                  className="text-xs"
                >
                  {isDeleting ? 'Wiping Everything...' : 'Confirm Wipe Everything'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Save button */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <span className="text-[11px] text-slate-500">
            {savedSuccess && (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check className="h-3 w-3" /> Preferences saved!
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-xs text-slate-400">
              Close
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} className="text-xs">
              Save Preferences
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
