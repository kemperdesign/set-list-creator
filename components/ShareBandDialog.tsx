import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2, UserPlus, AlertCircle } from 'lucide-react';
import Sheet from './Sheet';
import { supabase } from '../lib/supabase';

interface Props {
  bandId: string;
  bandName: string;
  onClose: () => void;
}

/**
 * Owner-only. Anyone whose account email is on this list can open and edit the band's
 * library and sets (they see it under "Shared with me").
 */
const ShareBandDialog: React.FC<Props> = ({ bandId, bandName, onClose }) => {
  const [members, setMembers] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('setlist_members')
      .select('email')
      .eq('setlist_id', bandId)
      .order('added_at', { ascending: true });
    if (error) {
      // Table not created yet (see supabase/schema.sql)
      setUnavailable(true);
    } else {
      setMembers((data || []).map(r => r.email));
    }
    setLoading(false);
  }, [bandId]);

  useEffect(() => { load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    const clean = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('setlist_members').insert({ setlist_id: bandId, email: clean });
    setBusy(false);
    if (error) {
      setError(error.code === '23505' ? 'That person already has access.' : error.message);
      return;
    }
    setEmail('');
    load();
  };

  const remove = async (addr: string) => {
    if (!supabase) return;
    await supabase.from('setlist_members').delete().eq('setlist_id', bandId).eq('email', addr);
    load();
  };

  return (
    <Sheet title={<>Share “{bandName}”</>} onClose={onClose}>
      <div className="p-4 space-y-4">
        {unavailable ? (
          <div className="flex items-start gap-2 p-3 bg-amber-900/30 border border-amber-800 text-amber-200 rounded-lg text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>Sharing isn't set up in the database yet. Run <code className="font-mono">supabase/schema.sql</code> in the Supabase SQL editor, then reopen this.</span>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-400">
              Add your bandmates' email addresses. When they create an account with that email, this band shows up for them
              and they can edit it live with you.
            </p>
            <form onSubmit={add} className="flex gap-2">
              <input
                type="email"
                inputMode="email"
                autoCapitalize="none"
                placeholder="bandmate@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
              <button disabled={busy} className="px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg flex items-center gap-1.5 text-xs font-black uppercase">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Add
              </button>
            </form>
            {error && <p className="text-xs text-red-400">{error}</p>}

            {loading ? (
              <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 text-gray-500 animate-spin" /></div>
            ) : members.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Only you can see this band right now.</p>
            ) : (
              <ul className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
                {members.map(m => (
                  <li key={m} className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <span className="text-sm text-gray-200 truncate">{m}</span>
                    <button onClick={() => remove(m)} className="p-2 text-gray-500 hover:text-red-400" aria-label={`Remove ${m}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
};

export default ShareBandDialog;
