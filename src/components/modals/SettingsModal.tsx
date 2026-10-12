'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Key, ShieldCheck, Database, Trash2, Cpu, Check } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClearAllData: () => void;
}

export function SettingsModal({ isOpen, onClose, onClearAllData }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('thinkmate_gemini_key') || '';
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      if (apiKey.trim()) {
        localStorage.setItem('thinkmate_gemini_key', apiKey.trim());
      } else {
        localStorage.removeItem('thinkmate_gemini_key');
      }
      localStorage.setItem('thinkmate_model', model);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleDeleteAll = () => {
    onClearAllData();
    setConfirmDelete(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings & Privacy"
      description="Configure your Gemini model, credentials, and data retention preferences."
      maxWidth="md"
    >
      <div className="space-y-5">
        {/* Model Selection */}
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
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Low Latency Thinking)</option>
            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            Official Google GenAI SDK (`@google/genai`) powers all thinking modes.
          </p>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5 text-sky-400" />
            Custom Gemini API Key <span className="text-slate-500 font-normal">(Optional)</span>
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIzaSy... (Leave blank to use server environment key)"
            className="w-full bg-[#101728] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
          />
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>Credentials are strictly relayed to server-side endpoints and never leaked.</span>
          </div>
        </div>

        {/* Supabase Storage Info */}
        <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex items-start gap-3">
          <Database className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-semibold text-slate-200">Persistence & Sync</span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Sessions are persisted locally with instant recovery, and can synchronize with Supabase PostgreSQL with Row Level Security.
            </p>
          </div>
        </div>

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

          {/* Delete all data */}
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-rose-400">Are you sure?</span>
              <Button variant="danger" size="sm" onClick={handleDeleteAll} className="h-7 text-xs">
                Yes, Wipe All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="text-xs"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Wipe All Data
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
