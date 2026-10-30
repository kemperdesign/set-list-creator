import { Song } from '../types';

const singerKey = (s?: Song) => (s?.vocalist || '').trim().toLowerCase();

/**
 * Reorders the songs of ONE set so the lead singer changes on every song. No song is added or removed.
 * Greedy "most songs left goes next" (never the same singer twice in a row) keeps the result as
 * alternating as the numbers allow. Songs with no singer listed are treated as one-offs and never clash.
 * `clashes` counts back-to-back repeats that could not be avoided (e.g. one singer has most of the set).
 */
export const alternateSingers = (ids: string[], songs: Record<string, Song>) => {
  const queues = new Map<string, string[]>();
  let anon = 0;
  ids.forEach(id => {
    const k = singerKey(songs[id]) || `__anon${anon++}`;
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k)!.push(id);
  });
  const firstKey = singerKey(songs[ids[0]]) || '';
  const out: string[] = [];
  let last = '';
  while (out.length < ids.length) {
    const live = [...queues.entries()].filter(([, q]) => q.length > 0);
    let pool = live.filter(([k]) => k !== last);
    if (pool.length === 0) pool = live; // unavoidable repeat
    const max = Math.max(...pool.map(([, q]) => q.length));
    let pick = pool.filter(([, q]) => q.length === max);
    // keep the original opener's singer first when they can still lead
    if (out.length === 0) { const f = pick.find(([k]) => k === firstKey); if (f) pick = [f]; }
    // otherwise prefer whoever appeared earliest in the original order
    pick.sort((a, b) => ids.indexOf(a[1][0]) - ids.indexOf(b[1][0]));
    const [k, q] = pick[0];
    out.push(q.shift()!);
    last = k;
  }
  let clashes = 0;
  out.forEach((id, i) => { const a = singerKey(songs[id]); if (i && a && a === singerKey(songs[out[i - 1]])) clashes++; });
  return { ids: out, clashes };
};

export const hasSingers = (ids: string[], songs: Record<string, Song>) => ids.some(id => singerKey(songs[id]));
