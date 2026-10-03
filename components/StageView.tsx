import React, { useEffect, useRef } from 'react';
import { Check, Lightbulb, LogOut, Music, Activity, Clock, AlignLeft, User, X } from 'lucide-react';
import { BoardData, Song } from '../types';
import { formatKey } from '../lib/keys';

interface Props {
  data: BoardData;
  bandName: string;
  userEmail?: string;
  /** Songs already opened this session (shown with a check). */
  playedIds: string[];
  lastId?: string | null;
  lightsOn: boolean;
  onOpenSong: (songId: string) => void;
  onOpenLights: () => void;
  /** Leave stage mode. */
  onExit: () => void;
  /** Shown when stage mode was opened in its own window. */
  standalone?: boolean;
}

/**
 * Full-screen performance view: just the setlist, big tap targets. Tap a song to open it (lyrics or
 * your own chart, auto-scroll, metronome). When the song ends the sheet closes and this list is back.
 */
const StageView: React.FC<Props> = ({ data, bandName, userEmail, playedIds, lastId, lightsOn, onOpenSong, onOpenLights, onExit, standalone }) => {
  const sets = data.columnOrder
    .filter(id => id.startsWith('setlist'))
    .map(id => ({ col: data.columns[id], songs: data.columns[id].songIds.map(sid => data.songs[sid]).filter(Boolean) as Song[] }))
    .filter(s => s.songs.length > 0);

  const flat = sets.flatMap(s => s.songs.map(x => x.id));
  const lastIdx = lastId ? flat.indexOf(lastId) : -1;
  const nextId = flat[lastIdx + 1];
  const me = (userEmail || '').toLowerCase();
  const nextRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    nextRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [lastId]);

  return (
    <div className="fixed inset-0 z-[100] bg-gray-950 flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/80 flex-shrink-0">
        <Music className="w-5 h-5 text-indigo-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-black text-white truncate">{bandName}</h1>
          <p className="text-[11px] text-gray-500 flex items-center gap-1.5 truncate">
            Stage{userEmail ? <><User className="w-3 h-3" />{userEmail.split('@')[0]}</> : null}
          </p>
        </div>
        <button onClick={onOpenLights} className={`h-11 px-3 rounded-lg flex items-center gap-1.5 text-[11px] font-black uppercase ${lightsOn ? 'bg-yellow-500/15 text-yellow-300' : 'bg-gray-800 text-gray-400'}`} title="Lights and cues">
          <Lightbulb className="w-4 h-4" />{lightsOn ? 'Cues on' : 'Cues off'}
        </button>
        <button onClick={onExit} className="h-11 px-3 rounded-lg bg-gray-800 text-gray-200 flex items-center gap-1.5 text-[11px] font-black uppercase">
          {standalone ? <LogOut className="w-4 h-4" /> : <X className="w-4 h-4" />}{standalone ? 'Full app' : 'Exit'}
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
        {sets.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-gray-400 px-6">
            <p className="text-lg font-bold text-gray-200">No setlist yet</p>
            <p className="text-sm">Generate or build your sets in the full app, then open Stage again.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6 pb-10">
            {sets.map(({ col, songs }) => (
              <section key={col.id}>
                <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2 px-1">{col.title} <span className="text-gray-600">- {songs.length} songs</span></h2>
                <div className="space-y-2">
                  {songs.map((s, i) => {
                    const played = playedIds.includes(s.id);
                    const isNext = s.id === nextId;
                    const key = formatKey(s.key);
                    const mine = !!(me && s.charts?.[me]);
                    return (
                      <button
                        key={s.id}
                        ref={isNext ? nextRef : undefined}
                        onClick={() => onOpenSong(s.id)}
                        className={`w-full text-left rounded-xl border px-4 py-3.5 flex items-center gap-3 active:scale-[0.99] transition ${
                          isNext ? 'bg-indigo-600/20 border-indigo-400 ring-1 ring-indigo-400/50' : played ? 'bg-gray-900/40 border-gray-800 opacity-60' : 'bg-gray-900 border-gray-800'
                        }`}
                      >
                        <span className="w-7 text-center text-sm font-mono text-gray-500 flex-shrink-0">{played ? <Check className="w-5 h-5 text-emerald-500 mx-auto" /> : i + 1}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-lg font-bold text-white truncate leading-tight">{s.title}</span>
                          <span className="block text-sm text-gray-400 truncate">{s.artist}{s.vocalist ? ` - ${s.vocalist}` : ''}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1 flex-shrink-0 text-[11px] font-mono">
                          <span className="flex items-center gap-2">
                            {key && <span className="flex items-center gap-0.5 text-fuchsia-300 font-bold"><Music className="w-3 h-3" />{key}</span>}
                            {s.bpm && <span className="flex items-center gap-0.5 text-gray-400"><Activity className="w-3 h-3" />{s.bpm}</span>}
                            {s.duration && <span className="flex items-center gap-0.5 text-emerald-400/80"><Clock className="w-3 h-3" />{s.duration}</span>}
                          </span>
                          <span className="flex items-center gap-2 text-[10px] text-gray-500 uppercase font-sans font-bold">
                            {mine && <span className="text-sky-300">My chart</span>}
                            {s.lyrics && <AlignLeft className="w-3.5 h-3.5 text-indigo-400" />}
                            {isNext && <span className="text-indigo-300">Up next</span>}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default StageView;
