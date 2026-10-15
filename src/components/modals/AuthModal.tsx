'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Lock, Mail, ShieldCheck, AlertCircle, Sparkles } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: { id: string; email?: string }) => void;
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please enter both your email address and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessNotice(null);

    const endpoint = tab === 'signin' ? '/api/auth/login' : '/api/auth/signup';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Authentication failed. Please check your credentials.');
        setIsLoading(false);
        return;
      }

      if (data.user) {
        onAuthSuccess(data.user);
        setEmail('');
        setPassword('');
        onClose();
      } else if (data.message) {
        setSuccessNotice(data.message);
      }
    } catch (err) {
      console.error('[AuthModal] Network error:', err);
      setErrorMessage('Network connection error. Please verify your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tab === 'signin' ? 'Sign in to ThinkMate' : 'Create ThinkMate Account'}
      description="Access your encrypted cloud thinking sessions and synchronize your insights across devices."
      maxWidth="sm"
    >
      <div className="space-y-4">
        {/* Sign In / Sign Up Tab Selector */}
        <div className="flex border-b border-slate-800">
          <button
            type="button"
            onClick={() => {
              setTab('signin');
              setErrorMessage(null);
              setSuccessNotice(null);
            }}
            className={`flex-1 pb-2.5 text-xs font-semibold text-center border-b-2 transition-all cursor-pointer ${
              tab === 'signin'
                ? 'border-sky-500 text-sky-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('signup');
              setErrorMessage(null);
              setSuccessNotice(null);
            }}
            className={`flex-1 pb-2.5 text-xs font-semibold text-center border-b-2 transition-all cursor-pointer ${
              tab === 'signup'
                ? 'border-sky-500 text-sky-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Error / Notice Banners */}
        {errorMessage && (
          <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2 text-rose-400 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successNotice && (
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start gap-2 text-emerald-400 text-xs">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-sky-400" />
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              className="w-full bg-[#101728] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-sky-400" />
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#101728] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isLoading}
              className="w-full text-xs font-medium"
            >
              {isLoading
                ? tab === 'signin'
                  ? 'Signing in...'
                  : 'Creating Account...'
                : tab === 'signin'
                ? 'Sign In'
                : 'Create Account'}
            </Button>
          </div>
        </form>

        {/* Security Assurance Footer */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span>Sessions use secure, server-managed HttpOnly cookies protected against XSS.</span>
        </div>
      </div>
    </Modal>
  );
}
