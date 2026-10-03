import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Music2, Search, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface PublicSong { id: string; t: string; a: string }

const read = (k: string, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const deviceId = () => {
  let id = read('REQ_DEVICE');
  if (!id) {
    id = (crypto as any)?.randomUUID?.() || `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    write('REQ_DEVICE', id);
  }
  return id;
};

const MESSAGES: Record<string, string> = {
  closed: 'Requests are closed right now.',
  invalid: 'Please enter a song title.',
  slow_down: 'Lots of requests from this phone! Give it a few minutes and try again.',
  duplicate: 'You already requested that one. The band has it!',
};

/** Public page the audience opens from the QR code. No sign-in. Only shows what the band chose to share. */
const RequestPage: React.FC<{ code: string | null }> = ({ code }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'closed' | 'none'>(code ? 'loading' : 'none');
  const [band, setBand] = useState('');
  const [songs, setSongs] = useState<PublicSong[]>([]);
  const [q, setQ] = useState('');
  const [name, setName] = useState(() => read('REQ_NAME'));
  const [sent, setSent] = useState<string[]>(() => { try { return JSON.parse(read('REQ_SENT_' + code, '[]')); } catch { return []; } });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [custom, setCustom] = useState({ title: '', artist: '', note: '' });

  useEffect(() => {
    if (!code || !supabase) { setState('none'); return; }
    supabase.rpc('request_get_band', { p_code: code }).then(({ data, error }) => {
      if (error || !data) { setState('closed'); return; }
      setBand(data.name || 'the band');
      setSongs(Array.isArray(data.songs) ? data.songs : []);
      setState('ready');
    });
  }, [code]);

  const submit = async (title: string, artist: string, songId: string | null, note = '') => {
    if (!supabase || !code) return false;
    setMsg('');
    write('REQ_NAME', name.trim());
    const key = (songId || title).toLowerCase();
    setBusy(key);
    const { data, error } = await supabase.rpc('request_submit', {
      p_code: code, p_title: title, p_artist: artist, p_song_id: songId, p_requester: name.trim(), p_note: note, p_device: deviceId(),
    });
    setBusy(null);
    if (error) { setMsg('Could not send. Check your connection and try again.'); return false; }
    if (data === 'ok' || data === 'duplicate') {
      const next = [...new Set([...sent, key])];
      setSent(next);
      write('REQ_SENT_' + code, JSON.stringify(next));
      if (data === 'duplicate') setMsg(MESSAGES.duplicate);
      return true;
    }
    setMsg(MESSAGES[data as string] || 'Something went wrong.');
    return false;
  };

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? songs.filter(s => s.t.toLowerCase().includes(t) || s.a.toLowerCase().includes(t)) : songs;
  }, [songs, q]);

  const input = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 outline-none';

  if (state === 'loading') return <div className="min-h-[100dvh] bg-gray-950 flex items-center justify-center text-gray-500 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>;

  if (state !== 'ready') {
    return (
      <div className="min-h-[100dvh] bg-gray-950 flex flex-col items-center justify-center text-center gap-3 p-8">
        <Music2 className="w-10 h-10 text-indigo-400" />
        <h1 className="text-xl font-black text-white">{state === 'closed' ? 'Requests are closed' : 'Song requests'}</h1>
        <p className="text-gray-400 text-sm max-w-xs">{state === 'closed' ? 'The band is not taking requests right now. Check back during the show!' : 'Scan the band\'s QR code to send a request.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gray-950 text-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3">
        <p className="text-[11px] font-black uppercase tracking-widest text-indigo-400">Request a song</p>
        <h1 className="text-xl font-black truncate">{band}</h1>
        <div className="relative mt-3">
          <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search songs or artists" className={`${input} pl-10`} />
        </div>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Your name (optional)" className={`${input} mt-2 py-2.5`} />
        {msg && <p className="text-sm text-amber-300 mt-2">{msg}</p>}
      </header>

      <main className="p-3 max-w-xl mx-auto space-y-2">
        {list.map(s => {
          const done = sent.includes(s.id.toLowerCase());
          return (
            <div key={s.id} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-base truncate">{s.t}</p>
                {s.a && <p className="text-sm text-gray-400 truncate">{s.a}</p>}
              </div>
              <button
                disabled={done || busy === s.id.toLowerCase()}
                onClick={() => submit(s.t, s.a, s.id)}
                className={`h-11 min-w-[96px] px-4 rounded-xl text-sm font-black flex items-center justify-center gap-1.5 ${done ? 'bg-emerald-600/20 text-emerald-300' : 'bg-indigo-600 text-white active:bg-indigo-500'}`}
              >
                {busy === s.id.toLowerCase() ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <><Check className="w-4 h-4" />Sent</> : 'Request'}
              </button>
            </div>
          );
        })}
        {list.length === 0 && <p className="text-center text-gray-500 py-6">No match in the band's list.</p>}

        <section className="mt-6 bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
          <h2 className="font-black">Do not see it? Ask for something else</h2>
          <input className={input} placeholder="Song title" value={custom.title} onChange={e => setCustom({ ...custom, title: e.target.value })} maxLength={200} />
          <input className={input} placeholder="Artist (optional)" value={custom.artist} onChange={e => setCustom({ ...custom, artist: e.target.value })} maxLength={200} />
          <input className={input} placeholder="Message to the band (optional, e.g. birthday!)" value={custom.note} onChange={e => setCustom({ ...custom, note: e.target.value })} maxLength={300} />
          <button
            disabled={!custom.title.trim() || busy !== null}
            onClick={async () => { if (await submit(custom.title.trim(), custom.artist.trim(), null, custom.note.trim())) setCustom({ title: '', artist: '', note: '' }); }}
            className="w-full h-12 rounded-xl bg-indigo-600 disabled:opacity-40 font-black flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" /> Send request
          </button>
          <p className="text-[11px] text-gray-500">The band sees requests live and plays what fits the night. No guarantees, but thank you!</p>
        </section>
      </main>
    </div>
  );
};

export default RequestPage;
