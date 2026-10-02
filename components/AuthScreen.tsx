import React, { useState } from 'react';
import { Disc3, Loader2, Mail, Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup' | 'forgot' | 'recovery';

interface AuthScreenProps {
  /** Set when the user arrived from a password-reset email link. */
  recovery?: boolean;
  onRecoveryDone?: () => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ recovery, onRecoveryDone }) => {
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: Mode) => { setMode(m); setError(null); setNotice(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice('Account created. Check your email for a confirmation link, then sign in.');
          setMode('signin');
        }
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setNotice('If that email has an account, a reset link is on its way.');
      } else if (mode === 'recovery') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        onRecoveryDone?.();
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const title = { signin: 'Sign in', signup: 'Create account', forgot: 'Reset password', recovery: 'Choose a new password' }[mode];
  const input = 'w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-3 py-3 text-white placeholder-gray-500 focus:ring-1 focus:ring-indigo-500 outline-none';

  return (
    <div
      className="min-h-[100dvh] bg-gray-950 flex items-center justify-center p-4"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg mb-3">
            <Disc3 className="w-8 h-8 text-white animate-spin-slow" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Set List Generator</h1>
          <p className="text-gray-400 text-[10px] uppercase font-bold tracking-widest">Intelligent Live Planning</p>
        </div>

        <form onSubmit={submit} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4 shadow-2xl">
          <h2 className="text-sm font-black text-white uppercase tracking-tight">{title}</h2>

          {mode !== 'recovery' && (
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                placeholder="Email"
                className={input}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          )}

          {mode !== 'forgot' && (
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'recovery' ? 'New password (6+ characters)' : 'Password (6+ characters)'}
                className={input}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-900/40 border border-red-800 text-red-200 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="flex items-start gap-2 p-3 bg-emerald-900/30 border border-emerald-800 text-emerald-200 rounded-lg text-sm">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{notice}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {{ signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recovery: 'Save new password' }[mode]}
          </button>

          {mode === 'signin' && (
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={() => switchMode('forgot')} className="text-gray-400 hover:text-white py-1">Forgot password?</button>
              <button type="button" onClick={() => switchMode('signup')} className="text-indigo-400 hover:text-indigo-300 font-bold py-1">Create account</button>
            </div>
          )}
          {(mode === 'signup' || mode === 'forgot') && (
            <button type="button" onClick={() => switchMode('signin')} className="w-full text-xs text-indigo-400 hover:text-indigo-300 font-bold py-1">
              Back to sign in
            </button>
          )}
        </form>

        <p className="text-center text-[11px] text-gray-600 mt-4">
          Your bands and song lists are saved to your account, so they follow you to any phone or computer.
        </p>
      </div>
    </div>
  );
};

export default AuthScreen;
