import React, { useCallback, useEffect, useState } from 'react';
import {
  Disc3, Plus, LogOut, Loader2, Music2, Layers, MoreVertical, Pencil, Copy, Share2, Trash2,
  Users, Smartphone, AlertCircle, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { BandSummary } from '../types';
import { countSets, countSongs, makeInitialData, normalizeBoard, STORAGE_KEY, timeAgo } from '../lib/boardData';
import { useDialogs } from '../lib/useDialogs';
import ShareBandDialog from './ShareBandDialog';

interface Props {
  userId: string;
  email: string;
  onOpen: (band: BandSummary) => void;
  onSignOut: () => void;
}

const BandManager: React.FC<Props> = ({ userId, email, onOpen, onSignOut }) => {
  const [bands, setBands] = useState<BandSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [shareBand, setShareBand] = useState<BandSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const { showAlert, showConfirm, showPrompt, dialogElement } = useDialogs();

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('setlists')
      .select('id,name,user_id,created_at,updated_at,data')
      .order('updated_at', { ascending: false });
    if (error) setError(error.message);
    else setBands((data || []) as BandSummary[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Library saved on this device by the pre-accounts version of the app
  const legacy = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const board = normalizeBoard(JSON.parse(raw));
      return countSongs(board) > 0 ? board : null;
    } catch { return null; }
  })();

  const createBand = async (seed = makeInitialData(), presetName?: string) => {
    if (!supabase) return;
    const name = presetName ?? (await showPrompt('New band', 'Name this band or song list:', ''));
    if (!name || !name.trim()) return;
    setBusy(true);
    const { data, error } = await supabase
      .from('setlists')
      .insert({ user_id: userId, name: name.trim(), data: seed })
      .select('id,name,user_id,created_at,updated_at,data')
      .single();
    setBusy(false);
    if (error || !data) { await showAlert('Could not create band', error?.message || 'Please try again.'); return; }
    onOpen(data as BandSummary);
  };

  const rename = async (b: BandSummary) => {
    setMenuId(null);
    const name = await showPrompt('Rename band', 'New name:', b.name);
    if (!name || !name.trim() || !supabase) return;
    const { error } = await supabase.from('setlists').update({ name: name.trim() }).eq('id', b.id);
    if (error) await showAlert('Could not rename', error.message);
    else load();
  };

  const duplicate = async (b: BandSummary) => {
    setMenuId(null);
    const name = await showPrompt('Duplicate band', 'Name for the copy (songs, lyrics and sets are copied):', `${b.name} (copy)`);
    if (!name) return;
    await createBand(normalizeBoard(b.data), name);
  };

  const remove = async (b: BandSummary) => {
    setMenuId(null);
    const ok = await showConfirm(
      'Delete band',
      `Delete "${b.name}" and all of its songs, lyrics and saved sets? Anyone you shared it with loses access too. This cannot be undone.`,
      { danger: true, confirmLabel: 'Delete' }
    );
    if (!ok || !supabase) return;
    const { error } = await supabase.from('setlists').delete().eq('id', b.id);
    if (error) await showAlert('Could not delete', error.message);
    else load();
  };

  const mine = bands.filter(b => b.user_id === userId);
  const shared = bands.filter(b => b.user_id !== userId);

  const Card = ({ b }: { b: BandSummary }) => {
    const isOwner = b.user_id === userId;
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-stretch">
          <button onClick={() => onOpen(b)} className="flex-1 min-w-0 text-left p-4 hover:bg-gray-800/60 active:bg-gray-800 transition-colors">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white truncate">{b.name}</h3>
              {!isOwner && <span className="text-[9px] font-black uppercase bg-indigo-600/20 text-indigo-300 px-1.5 py-0.5 rounded flex items-center gap-1"><Users className="w-2.5 h-2.5" />Shared</span>}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              <span className="flex items-center gap-1"><Music2 className="w-3 h-3" />{countSongs(b.data)} songs</span>
              <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{countSets(b.data)} sets</span>
              <span className="text-gray-600">· {timeAgo(b.updated_at)}</span>
            </div>
          </button>
          {isOwner ? (
            <button
              onClick={() => setMenuId(menuId === b.id ? null : b.id)}
              aria-label="Band options"
              className="px-4 text-gray-500 hover:text-white border-l border-gray-800"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={() => onOpen(b)} aria-label="Open" className="px-4 text-gray-600 border-l border-gray-800">
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
        {menuId === b.id && isOwner && (
          <div className="grid grid-cols-4 border-t border-gray-800 bg-gray-950/50 text-[10px] font-bold uppercase">
            <button onClick={() => rename(b)} className="py-3 flex flex-col items-center gap-1 text-gray-300 hover:bg-gray-800"><Pencil className="w-4 h-4" />Rename</button>
            <button onClick={() => duplicate(b)} className="py-3 flex flex-col items-center gap-1 text-gray-300 hover:bg-gray-800"><Copy className="w-4 h-4" />Copy</button>
            <button onClick={() => { setMenuId(null); setShareBand(b); }} className="py-3 flex flex-col items-center gap-1 text-indigo-300 hover:bg-gray-800"><Share2 className="w-4 h-4" />Share</button>
            <button onClick={() => remove(b)} className="py-3 flex flex-col items-center gap-1 text-red-400 hover:bg-gray-800"><Trash2 className="w-4 h-4" />Delete</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="min-h-[100dvh] bg-gray-950 text-gray-100"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {dialogElement}
      {shareBand && <ShareBandDialog bandId={shareBand.id} bandName={shareBand.name} onClose={() => setShareBand(null)} />}

      <div className="max-w-xl mx-auto px-4 py-4">
        <header className="flex items-center justify-between gap-3 pb-4 border-b border-gray-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-lg"><Disc3 className="w-5 h-5 text-white animate-spin-slow" /></div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-white tracking-tight leading-tight">My Bands</h1>
              <p className="text-[11px] text-gray-500 truncate">{email}</p>
            </div>
          </div>
          <button onClick={onSignOut} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase text-gray-300 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </header>

        <p className="text-xs text-gray-500 mt-3 mb-4">
          Each band has its own song library, lyrics and sets. Pick one to open it.
        </p>

        <button
          onClick={() => createBand()}
          disabled={busy}
          className="w-full mb-5 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} New band
        </button>

        {error && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-red-900/40 border border-red-800 text-red-200 rounded-lg text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>
        ) : (
          <div className="space-y-6">
            {mine.length === 0 && shared.length === 0 && (
              <div className="text-center py-10 border border-dashed border-gray-800 rounded-xl px-4">
                <p className="text-gray-300 font-semibold">No bands yet</p>
                <p className="text-xs text-gray-500 mt-1">Create one, then import your songs from the CSV template.</p>
              </div>
            )}

            {mine.length > 0 && (
              <section className="space-y-2.5">
                {mine.map(b => <Card key={b.id} b={b} />)}
              </section>
            )}

            {shared.length > 0 && (
              <section className="space-y-2.5">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-500">Shared with me</h2>
                {shared.map(b => <Card key={b.id} b={b} />)}
              </section>
            )}

            {legacy && (
              <button
                onClick={() => createBand(legacy, 'My Band')}
                className="w-full p-3 text-left bg-gray-900 border border-gray-800 rounded-xl hover:bg-gray-800 flex items-center gap-3"
              >
                <Smartphone className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <span className="text-xs text-gray-300">
                  <span className="font-bold text-white block">Import songs saved on this device</span>
                  {countSongs(legacy)} songs from before accounts existed. Creates a new band with them.
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BandManager;
