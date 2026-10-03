import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Volume2, VolumeX, Zap } from 'lucide-react';

interface MetronomeProps {
  /** Tempo, shared with the teleprompter so both always agree. */
  bpm: number;
  onBpmChange: (bpm: number) => void;
}

const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const clamp = (n: number) => Math.min(300, Math.max(30, Math.round(n)));

/**
 * Blinking metronome for reading lyrics on stage. The beat flashes the edges of the screen
 * (amber on beat 1, indigo on the others) and a dot in the controls. A click sound is optional.
 */
const Metronome: React.FC<MetronomeProps> = ({ bpm, onBpmChange }) => {
  const [on, setOn] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [sound, setSound] = useState(() => read('SETLIST_METRO_SOUND', '0') === '1');
  const [edge, setEdge] = useState(() => read('SETLIST_METRO_EDGE', '1') === '1');
  const [beats, setBeats] = useState(() => Number(read('SETLIST_METRO_BEATS', '4')) || 4);
  const audio = useRef<AudioContext | null>(null);
  const taps = useRef<number[]>([]);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const click = (accent: boolean) => {
    const ctx = audio.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  };

  useEffect(() => {
    if (!on) { setBeat(-1); return; }
    let raf = 0;
    let last = -1;
    const start = performance.now();
    const tick = (now: number) => {
      const idx = Math.floor((now - start) / (60000 / bpm));
      if (idx !== last) {
        last = idx;
        setBeat(idx);
        if (soundRef.current) click(idx % beats === 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, bpm, beats]);

  useEffect(() => () => { audio.current?.close().catch(() => {}); }, []);

  const toggle = () => {
    if (!on && !audio.current) {
      try {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (Ctor) audio.current = new Ctor();
      } catch { /* sound just stays off */ }
    }
    audio.current?.resume?.().catch(() => {});
    setOn(o => !o);
  };

  const tap = () => {
    const now = performance.now();
    const t = taps.current.filter(x => now - x < 2500);
    t.push(now);
    taps.current = t.slice(-5);
    if (taps.current.length >= 2) {
      const gaps = taps.current.slice(1).map((x, i) => x - taps.current[i]);
      onBpmChange(clamp(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)));
    }
  };

  const accent = beat >= 0 && beat % beats === 0;
  const color = accent ? '#f59e0b' : '#6366f1';
  const btn = 'h-11 min-w-[44px] px-2 flex items-center justify-center rounded-lg text-xs font-black uppercase';

  return (
    <>
      {on && edge && beat >= 0 && (
        <div
          key={beat}
          aria-hidden
          className="metro-edge"
          style={{ ['--metro' as any]: color }}
        />
      )}
      <div className="flex items-center gap-1.5">
        <button
          onClick={toggle}
          aria-pressed={on}
          title="Blinking metronome"
          className={`${btn} gap-2 ${on ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-200'}`}
        >
          <span
            key={`dot-${beat}`}
            className={`inline-block w-3 h-3 rounded-full ${on ? 'metro-dot' : 'bg-gray-500'}`}
            style={on && beat >= 0 ? { background: color } : undefined}
          />
          Click
        </button>
        <button onClick={() => onBpmChange(clamp(bpm - 1))} aria-label="Slower" className={`${btn} bg-gray-800 text-gray-200`}><Minus className="w-4 h-4" /></button>
        <button onClick={tap} title="Tap the tempo" className={`${btn} bg-gray-800 text-white font-mono normal-case w-14`}>{bpm}</button>
        <button onClick={() => onBpmChange(clamp(bpm + 1))} aria-label="Faster" className={`${btn} bg-gray-800 text-gray-200`}><Plus className="w-4 h-4" /></button>
        <button
          onClick={() => { const n = beats === 4 ? 3 : beats === 3 ? 6 : beats === 6 ? 2 : 4; setBeats(n); write('SETLIST_METRO_BEATS', String(n)); }}
          title="Beats per bar (the amber flash is beat 1)"
          className={`${btn} bg-gray-800 text-gray-300 font-mono normal-case`}
        >
          {beats}/4
        </button>
        <button
          onClick={() => { setSound(s => { write('SETLIST_METRO_SOUND', s ? '0' : '1'); return !s; }); }}
          aria-label={sound ? 'Click sound on' : 'Click sound off'}
          title="Click sound"
          className={`${btn} ${sound ? 'bg-gray-700 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}
        >
          {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setEdge(e => { write('SETLIST_METRO_EDGE', e ? '0' : '1'); return !e; })}
          aria-label={edge ? 'Screen-edge flash on' : 'Screen-edge flash off'}
          title="Flash the screen edges on every beat"
          className={`${btn} ${edge ? 'bg-gray-700 text-amber-300' : 'bg-gray-800 text-gray-500'}`}
        >
          <Zap className="w-4 h-4" />
        </button>
      </div>
    </>
  );
};

export default Metronome;
