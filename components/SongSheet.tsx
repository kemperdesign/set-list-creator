import React, { useEffect, useRef, useState } from 'react';
import {
  Printer, Mail, MessageSquare, Share2, Copy, Check, ChevronLeft, ChevronRight,
  Pencil, Info, AlignLeft, Trash2, ArrowRightLeft, Minus, Plus, Music, Sparkles, Loader2, Play, Pause, ALargeSmall,
} from 'lucide-react';
import Sheet from './Sheet';
import Metronome from './Metronome';
import { Song } from '../types';
import { COMMON_KEYS, formatKey } from '../lib/keys';
import { normalizeDuration } from '../lib/csv';
import { canNativeShare, copyText, mailtoHref, nativeShare, printSongs, smsHref, songToText } from '../lib/shareSong';

interface Destination { id: string; title: string }

interface SongSheetProps {
  song: Song;
  currentColumnId: string;
  destinations: Destination[];
  prevId?: string;
  nextId?: string;
  positionLabel?: string;
  onNavigate: (songId: string) => void;
  onUpdate: (songId: string, updates: Partial<Song>) => void;
  onMove: (songId: string, toColumnId: string) => void;
  onDelete: (songId: string) => void;
  /** AI lookup of missing artist/key/BPM/length/year. Fills only empty fields and returns what it added. */
  onAutoFill?: (songId: string) => Promise<{ updates: Partial<Song>; error?: string }>;
  onClose: () => void;
}

type Mode = 'lyrics' | 'edit' | 'details';

const SIZE_KEY = 'SETLIST_LYRIC_SIZE';
const MONO_KEY = 'SETLIST_LYRIC_MONO';

const readNum = (k: string, d: number) => {
  try { const v = parseInt(localStorage.getItem(k) || '', 10); return Number.isFinite(v) ? v : d; } catch { return d; }
};
const readBool = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };

const SongSheet: React.FC<SongSheetProps> = ({
  song, currentColumnId, destinations, prevId, nextId, positionLabel,
  onNavigate, onUpdate, onMove, onDelete, onAutoFill, onClose,
}) => {
  const [filling, setFilling] = useState(false);
  const [fillMsg, setFillMsg] = useState('');
  const [mode, setMode] = useState<Mode>('lyrics');
  const [fontSize, setFontSize] = useState(() => readNum(SIZE_KEY, 20));
  const [mono, setMono] = useState(() => readBool(MONO_KEY));
  const [lyricsDraft, setLyricsDraft] = useState(song.lyrics || '');
  const [copied, setCopied] = useState(false);

  // Perform tools: one tempo drives both the blinking metronome and the teleprompter scroll.
  const [tempo, setTempo] = useState(() => song.bpm || 100);
  const [scrolling, setScrolling] = useState(false);
  const [barsPerLine, setBarsPerLine] = useState(() => readNum('SETLIST_TP_BARS', 2));
  const [trim, setTrim] = useState(1);
  const [returnWhenDone, setReturnWhenDone] = useState(() => readNum('SETLIST_TP_RETURN', 1) === 1);
  const lyricsRef = useRef<HTMLPreElement | null>(null);

  const [draft, setDraft] = useState({
    title: song.title,
    artist: song.artist,
    key: song.key || '',
    bpm: song.bpm ? String(song.bpm) : '',
    duration: song.duration || '',
    vocalist: song.vocalist || '',
    year: song.year ? String(song.year) : '',
  });

  // Reset the drafts when stepping to another song (prev/next).
  useEffect(() => {
    setMode('lyrics');
    setLyricsDraft(song.lyrics || '');
    setDraft({
      title: song.title,
      artist: song.artist,
      key: song.key || '',
      bpm: song.bpm ? String(song.bpm) : '',
      duration: song.duration || '',
      vocalist: song.vocalist || '',
      year: song.year ? String(song.year) : '',
    });
  }, [song.id]);

  // Keep the phone awake while reading lyrics on stage.
  useEffect(() => {
    if (mode !== 'lyrics') return;
    let lock: any = null;
    let cancelled = false;
    (navigator as any).wakeLock?.request?.('screen').then((l: any) => {
      if (cancelled) l.release?.(); else lock = l;
    }).catch(() => {});
    return () => { cancelled = true; lock?.release?.(); };
  }, [mode]);

  // Teleprompter: scrolls the lyrics at the song's tempo (one line every `barsPerLine` bars of 4/4).
  useEffect(() => {
    if (!scrolling) return;
    const pre = lyricsRef.current;
    if (!pre) { setScrolling(false); return; }
    let scroller: HTMLElement | null = pre.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) { setScrolling(false); return; }
    const box = scroller;

    const lineH = parseFloat(getComputedStyle(pre).lineHeight) || fontSize * 1.625;
    const pxPerSec = (lineH / ((barsPerLine * 4 * 60) / tempo)) * trim;
    const atEnd = () => box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
    if (atEnd()) box.scrollTop = 0;

    let pos = box.scrollTop;
    let last = performance.now();
    let raf = 0;
    let done: number | undefined;
    const tick = (now: number) => {
      pos += pxPerSec * ((now - last) / 1000);
      last = now;
      box.scrollTop = pos;
      if (atEnd()) {
        setScrolling(false);
        if (returnWhenDone) done = window.setTimeout(onClose, 1500);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Touching or wheeling the lyrics takes manual control.
    const stop = () => setScrolling(false);
    box.addEventListener('touchstart', stop, { passive: true });
    box.addEventListener('wheel', stop, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      if (done !== undefined) { /* keep the pending return so a finished song still hands back the setlist */ }
      box.removeEventListener('touchstart', stop);
      box.removeEventListener('wheel', stop);
    };
  }, [scrolling, tempo, barsPerLine, trim, fontSize, returnWhenDone]);

  const changeSize = (delta: number) => {
    const next = Math.min(72, Math.max(12, fontSize + delta));
    setFontSize(next);
    try { localStorage.setItem(SIZE_KEY, String(next)); } catch {}
  };
  const toggleMono = () => {
    setMono(m => {
      try { localStorage.setItem(MONO_KEY, m ? '0' : '1'); } catch {}
      return !m;
    });
  };

  const saveLyrics = () => {
    onUpdate(song.id, { lyrics: lyricsDraft.trim() || undefined });
    setMode('lyrics');
  };

  const saveDetails = () => {
    const bpm = parseInt(draft.bpm, 10);
    const year = parseInt(draft.year, 10);
    onUpdate(song.id, {
      title: draft.title.trim() || song.title,
      artist: draft.artist.trim() || 'Unknown Artist',
      key: formatKey(draft.key) || undefined,
      bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined,
      duration: normalizeDuration(draft.duration),
      vocalist: draft.vocalist.trim() || undefined,
      year: Number.isFinite(year) && year > 1000 ? year : undefined,
    });
    setMode('lyrics');
  };

  const autoFill = async () => {
    if (!onAutoFill) return;
    setFilling(true);
    setFillMsg('');
    try {
      // Fields typed in the form but not saved yet count as filled, so they are not overwritten.
      const { updates, error } = await onAutoFill(song.id);
      if (error) { setFillMsg(error); return; }
      const names = Object.keys(updates);
      if (names.length === 0) { setFillMsg('Nothing to add. Everything is filled in, or the AI was not sure about this song.'); return; }
      setDraft(d => ({
        ...d,
        artist: d.artist.trim() && !/^unknown artist$/i.test(d.artist.trim()) ? d.artist : (updates.artist ?? d.artist),
        key: d.key.trim() ? d.key : (updates.key ?? d.key),
        bpm: d.bpm.trim() ? d.bpm : (updates.bpm ? String(updates.bpm) : d.bpm),
        duration: d.duration.trim() ? d.duration : (updates.duration ?? d.duration),
        year: d.year.trim() ? d.year : (updates.year ? String(updates.year) : d.year),
      }));
      setFillMsg(`Added ${names.join(', ')}. Double-check them; AI can be wrong.`);
    } catch (e) {
      setFillMsg(e instanceof Error ? e.message : 'The AI request failed.');
    } finally {
      setFilling(false);
    }
  };

  const copy = async () => {
    if (await copyText(songToText(song))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const share = async () => {
    try { await nativeShare(song); } catch { /* user cancelled */ }
  };

  const key = formatKey(song.key);
  const input = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:ring-1 focus:ring-indigo-500 outline-none';
  const label = 'text-[10px] font-black text-gray-500 uppercase mb-1 block';
  const actionBtn = 'flex-1 min-w-[64px] flex flex-col items-center gap-1 py-2 text-[10px] font-bold uppercase text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors';

  const tab = (m: Mode, text: string, icon: React.ReactNode) => (
    <button
      onClick={() => setMode(m)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-black uppercase rounded-md transition-colors ${mode === m ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
    >
      {icon}{text}
    </button>
  );

  const barsLabel = barsPerLine === 1 ? '1 bar/line' : `${barsPerLine} bars/line`;
  const estLines = (song.lyrics || '').split('\n').length;
  const estSecs = Math.round((estLines * barsPerLine * 4 * 60) / tempo / trim);
  const perform = (
    <div className="space-y-2 pb-1 border-b border-gray-800">
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <Metronome bpm={tempo} onBpmChange={setTempo} />
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <button onClick={() => changeSize(-4)} aria-label="Smaller lyrics" className="h-11 w-11 flex items-center justify-center rounded-lg bg-gray-800 text-gray-200"><ALargeSmall className="w-4 h-4" /></button>
        <span className="text-[11px] text-gray-400 font-mono w-9 text-center">{fontSize}</span>
        <button onClick={() => changeSize(4)} aria-label="Bigger lyrics" className="h-11 w-11 flex items-center justify-center rounded-lg bg-gray-800 text-gray-200"><ALargeSmall className="w-6 h-6" /></button>
        {song.lyrics && (
          <>
            <button
              onClick={() => setScrolling(v => !v)}
              className={`h-11 px-3 flex items-center gap-1.5 rounded-lg text-xs font-black uppercase ${scrolling ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-200'}`}
              title="Auto-scroll the lyrics at the song's tempo"
            >
              {scrolling ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />} Scroll
            </button>
            <button onClick={() => setTrim(t => Math.max(0.5, +(t - 0.1).toFixed(1)))} aria-label="Scroll slower" className="h-11 w-10 flex items-center justify-center rounded-lg bg-gray-800 text-gray-200"><Minus className="w-4 h-4" /></button>
            <span className="text-[11px] text-gray-400 font-mono w-9 text-center">{trim.toFixed(1)}x</span>
            <button onClick={() => setTrim(t => Math.min(2, +(t + 0.1).toFixed(1)))} aria-label="Scroll faster" className="h-11 w-10 flex items-center justify-center rounded-lg bg-gray-800 text-gray-200"><Plus className="w-4 h-4" /></button>
            <button
              onClick={() => setBarsPerLine(b => { const n = b === 2 ? 4 : b === 4 ? 1 : 2; try { localStorage.setItem('SETLIST_TP_BARS', String(n)); } catch {} return n; })}
              title="How many bars each lyric line lasts. Slower songs or long lines want more."
              className="h-11 px-2 rounded-lg bg-gray-800 text-gray-300 text-[10px] font-bold uppercase whitespace-nowrap"
            >
              {barsLabel}
            </button>
            <button
              onClick={() => setReturnWhenDone(r => { try { localStorage.setItem('SETLIST_TP_RETURN', r ? '0' : '1'); } catch {} return !r; })}
              title="Go back to the setlist when the lyrics finish"
              className={`h-11 px-2 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap ${returnWhenDone ? 'bg-gray-700 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}
            >
              Auto-return
            </button>
            <span className="text-[10px] text-gray-500 whitespace-nowrap pl-1">~{Math.floor(estSecs / 60)}:{String(estSecs % 60).padStart(2, '0')}</span>
          </>
        )}
      </div>
    </div>
  );

  const footer = mode === 'lyrics' ? (
    <div className="p-2 space-y-2">
      {perform}
      <div className="flex gap-1.5">
        <button className={actionBtn} onClick={() => printSongs([song], mono, 16)}><Printer className="w-4 h-4" />Print</button>
        <a className={actionBtn} href={mailtoHref(song)}><Mail className="w-4 h-4" />Email</a>
        <a className={actionBtn} href={smsHref(song)}><MessageSquare className="w-4 h-4" />Text</a>
        {canNativeShare() && <button className={actionBtn} onClick={share}><Share2 className="w-4 h-4" />Share</button>}
        <button className={actionBtn} onClick={copy}>{copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {(prevId || nextId) && (
        <div className="flex items-center gap-2">
          <button disabled={!prevId} onClick={() => prevId && onNavigate(prevId)} className="flex-1 py-2.5 flex items-center justify-center gap-1 text-xs font-bold uppercase bg-gray-800 disabled:opacity-30 rounded-lg text-gray-200">
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          {positionLabel && <span className="text-[11px] text-gray-500 font-mono">{positionLabel}</span>}
          <button disabled={!nextId} onClick={() => nextId && onNavigate(nextId)} className="flex-1 py-2.5 flex items-center justify-center gap-1 text-xs font-bold uppercase bg-gray-800 disabled:opacity-30 rounded-lg text-gray-200">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <Sheet
      wide
      fullOnMobile
      onClose={onClose}
      footer={footer}
      title={
        <span className="flex flex-col min-w-0">
          <span className="truncate normal-case text-base">{song.title}</span>
          <span className="flex items-center gap-2 text-[11px] text-gray-400 normal-case font-medium">
            <span className="truncate">{song.artist}</span>
            {key && <span className="flex items-center gap-0.5 text-fuchsia-300 font-mono font-bold"><Music className="w-3 h-3" />{key}</span>}
          </span>
        </span>
      }
    >
      <div className="p-3 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
        <div className="flex p-0.5 bg-gray-950 rounded-lg border border-gray-800 gap-0.5">
          {tab('lyrics', 'Lyrics', <AlignLeft className="w-3.5 h-3.5" />)}
          {tab('edit', 'Edit lyrics', <Pencil className="w-3.5 h-3.5" />)}
          {tab('details', 'Details', <Info className="w-3.5 h-3.5" />)}
        </div>
      </div>

      {mode === 'lyrics' && (
        <div className="p-4">
          {song.lyrics ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => changeSize(-2)} aria-label="Smaller text" className="p-2 bg-gray-800 rounded-lg text-gray-300"><Minus className="w-4 h-4" /></button>
                <span className="text-xs text-gray-500 font-mono w-10 text-center">{fontSize}px</span>
                <button onClick={() => changeSize(2)} aria-label="Larger text" className="p-2 bg-gray-800 rounded-lg text-gray-300"><Plus className="w-4 h-4" /></button>
                <button
                  onClick={toggleMono}
                  className={`ml-auto px-3 py-2 text-[10px] font-black uppercase rounded-lg ${mono ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300'}`}
                  title="Monospace keeps chords lined up over lyrics"
                >
                  Chord chart
                </button>
              </div>
              <pre
                ref={lyricsRef}
                className="whitespace-pre-wrap break-words text-gray-100 leading-relaxed"
                style={{ fontSize, fontFamily: mono ? 'ui-monospace, Menlo, Consolas, monospace' : 'inherit' }}
              >
                {song.lyrics}
              </pre>
            </>
          ) : (
            <div className="text-center py-14 space-y-3">
              <AlignLeft className="w-8 h-8 text-gray-600 mx-auto" />
              <p className="text-gray-400 text-sm">No lyrics saved for this song yet.</p>
              <button onClick={() => setMode('edit')} className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase rounded-lg">
                Add lyrics
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500">
            Paste your own lyrics or chord chart. Line breaks are kept. Everyone in the band sees the same lyrics.
          </p>
          <textarea
            value={lyricsDraft}
            onChange={e => setLyricsDraft(e.target.value)}
            rows={14}
            placeholder={'[Verse 1]\n...'}
            className={`${input} resize-y leading-relaxed ${mono ? 'font-mono' : ''}`}
            style={{ minHeight: '40vh' }}
          />
          <div className="flex gap-2">
            <button onClick={() => { setLyricsDraft(song.lyrics || ''); setMode('lyrics'); }} className="flex-1 py-3 text-xs font-black uppercase text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg">Cancel</button>
            <button onClick={saveLyrics} className="flex-[2] py-3 text-xs font-black uppercase text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg">Save lyrics</button>
          </div>
        </div>
      )}

      {mode === 'details' && (
        <div className="p-4 space-y-4">
          {onAutoFill && (
            <div>
              <button
                onClick={autoFill}
                disabled={filling}
                className="w-full py-2.5 text-xs font-black uppercase text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-lg flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {filling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Fill missing with AI
              </button>
              {fillMsg && <p className="text-[11px] text-gray-400 mt-1.5">{fillMsg}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={label}>Title</label>
              <input className={input} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className={label}>Artist</label>
              <input className={input} value={draft.artist} onChange={e => setDraft({ ...draft, artist: e.target.value })} />
            </div>
            <div>
              <label className={label}>Key</label>
              <input
                className={input}
                list="song-keys"
                placeholder="G, F#m, Bb"
                autoCapitalize="characters"
                value={draft.key}
                onChange={e => setDraft({ ...draft, key: e.target.value })}
              />
              <datalist id="song-keys">{COMMON_KEYS.map(k => <option key={k} value={k} />)}</datalist>
            </div>
            <div>
              <label className={label}>BPM</label>
              <input className={input} inputMode="numeric" value={draft.bpm} onChange={e => setDraft({ ...draft, bpm: e.target.value })} />
            </div>
            <div>
              <label className={label}>Duration (M:SS)</label>
              <input className={input} placeholder="3:45" value={draft.duration} onChange={e => setDraft({ ...draft, duration: e.target.value })} />
            </div>
            <div>
              <label className={label}>Year</label>
              <input className={input} inputMode="numeric" value={draft.year} onChange={e => setDraft({ ...draft, year: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className={label}>Vocalist</label>
              <input className={input} value={draft.vocalist} onChange={e => setDraft({ ...draft, vocalist: e.target.value })} />
            </div>
          </div>
          <button onClick={saveDetails} className="w-full py-3 text-xs font-black uppercase text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg">
            Save details
          </button>

          <div>
            <p className={`${label} flex items-center gap-1`}><ArrowRightLeft className="w-3 h-3" /> Move to</p>
            <div className="grid grid-cols-2 gap-2">
              {destinations.map(d => (
                <button
                  key={d.id}
                  disabled={d.id === currentColumnId}
                  onClick={() => { onMove(song.id, d.id); onClose(); }}
                  className="py-2.5 px-3 text-xs font-bold text-left rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100 disabled:opacity-40 disabled:hover:bg-gray-800"
                >
                  {d.title}{d.id === currentColumnId ? ' (here)' : ''}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => onDelete(song.id)}
            className="w-full py-3 text-xs font-black uppercase text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Delete song from band
          </button>
        </div>
      )}
    </Sheet>
  );
};

export default SongSheet;
