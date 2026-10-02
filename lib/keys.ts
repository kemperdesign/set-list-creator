import { Song } from '../types';

/**
 * Musical key helpers.
 *
 * Used to (a) show a clean key on each song and (b) group songs in a set by key so the
 * band makes fewer instrument changes (capos, alternate tunings, keyboard patches, harp swaps).
 * Enharmonic spellings (F# / Gb) are treated as the same key. Relative major/minor pairs
 * (C / Am) sit next to each other because they share the same notes.
 */

const SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

export interface KeyInfo {
  /** Canonical label, e.g. "F#m" or "Bb" */
  label: string;
  minor: boolean;
  /** Position on the circle of fifths of the key signature (relative major for minors), 0-11 */
  fifths: number;
}

export function parseKey(raw?: string | null): KeyInfo | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/\s+/g, ' ');
  const m = cleaned.match(/^([A-Ga-g])\s*([#b]?)\s*(m|min|minor|maj|major|M)?$/);
  if (!m) return null;

  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const quality = m[3] || '';
  // lowercase letter followed by nothing is ambiguous; treat a trailing "m"/"min"/"minor" as minor only.
  const minor = quality === 'm' || quality === 'min' || quality === 'minor';

  let pc = SEMITONES[letter];
  if (accidental === '#') pc += 1;
  if (accidental === 'b') pc -= 1;
  pc = ((pc % 12) + 12) % 12;

  const relativeMajorPc = minor ? (pc + 3) % 12 : pc;
  const fifths = (relativeMajorPc * 7) % 12;

  return { label: minor ? MINOR_NAMES[pc] : MAJOR_NAMES[pc], minor, fifths };
}

/** Display form of a key: canonical when we understand it, otherwise whatever was typed. */
export function formatKey(raw?: string | null): string {
  const info = parseKey(raw);
  return info ? info.label : (raw || '').trim();
}

export const COMMON_KEYS = [...MAJOR_NAMES, ...MINOR_NAMES];

/**
 * Stable-sort the given songs so identical keys are together, and the groups travel around the
 * circle of fifths (so neighbouring groups are closely related keys). The group order starts
 * from the first song's key so the opener stays put. Songs with no usable key go last.
 * Within a key group the original order is preserved (so tempo/singer mixing survives).
 */
export function groupSongIdsByKey(ids: string[], songs: Record<string, Song>): string[] {
  const entries = ids.map((id, index) => ({ id, index, info: parseKey(songs[id]?.key) }));
  const firstKnown = entries.find(e => e.info);
  if (!firstKnown) return ids;
  const start = firstKnown.info!.fifths;

  const rank = (e: (typeof entries)[number]) =>
    e.info ? ((e.info.fifths - start + 12) % 12) * 2 + (e.info.minor ? 1 : 0) : 1000;

  return [...entries]
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .map(e => e.id);
}

/** How many key changes a given running order has (0 = every song in the same key). */
export function countKeyChanges(ids: string[], songs: Record<string, Song>): number {
  let changes = 0;
  let prev: string | null = null;
  ids.forEach(id => {
    const info = parseKey(songs[id]?.key);
    if (!info) return;
    if (prev !== null && prev !== info.label) changes++;
    prev = info.label;
  });
  return changes;
}
