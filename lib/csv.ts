import { Song } from '../types';
import { uid } from './boardData';
import { formatKey } from './keys';

/** Column order of the downloadable template. Only Title is required. */
export const TEMPLATE_HEADERS = ['Title', 'Artist', 'Duration', 'BPM', 'Key', 'Vocalist', 'Year', 'Lyrics'];

const csvEscape = (v: string | number | undefined | null) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toCsv = (rows: (string | number | undefined | null)[][]) =>
  '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';

/**
 * Template the band downloads, fills in (Excel / Numbers / Google Sheets) and uploads again.
 * Rows starting with "#" are comments and are ignored on import, so the instructions and the
 * example rows never end up in a library.
 */
export function buildTemplateCsv(): string {
  return toCsv([
    ['# SET LIST IMPORT TEMPLATE - one song per row, under the header row. Rows starting with # are ignored.'],
    ['# Only Title is required. Duration is M:SS (3:45). Key is like G, F#m or Bb. Year is 4 digits. Lyrics is optional (wrap in quotes if it has line breaks).'],
    ['# Keep the header row exactly as is. Save as CSV (comma delimited) before uploading.'],
    TEMPLATE_HEADERS,
    ['#EXAMPLE Mr. Brightside', 'The Killers', '3:42', 148, 'B', 'Brandon', 2003, ''],
    ['#EXAMPLE Sweet Home Alabama', 'Lynyrd Skynyrd', '4:45', 98, 'G', 'Ronnie', 1974, ''],
  ]);
}

export function exportSongsCsv(songs: Song[]): string {
  return toCsv([
    TEMPLATE_HEADERS,
    ...songs.map(s => [s.title, s.artist, s.duration, s.bpm, s.key, s.vocalist, s.year, s.lyrics]),
  ]);
}

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** "3:45", "03:45", "3.75" (minutes), "225" (seconds) -> "3:45". Anything else -> undefined. */
export function normalizeDuration(input: unknown): string | undefined {
  const s = String(input ?? '').trim();
  if (!s) return undefined;
  const clock = s.match(/^(\d{1,3}):(\d{2})$/);
  if (clock) return `${parseInt(clock[1], 10)}:${clock[2]}`;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    const totalSeconds = n < 30 ? Math.round(n * 60) : Math.round(n);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  }
  return undefined;
}

/** RFC-4180-ish parser: quotes, escaped quotes, newlines inside quotes, , ; or tab delimiters. */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const probe = clean.split(/\r?\n/).find(l => l.trim() && !l.trim().startsWith('#')) || '';
  const delim = [',', ';', '\t']
    .map(d => ({ d, n: probe.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += c;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

export interface SkippedRow { row: number; reason: string }
export interface ImportResult { songs: Song[]; skipped: SkippedRow[]; error?: string }

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function findCol(headers: string[], exact: string[], contains: string[] = []): number {
  const byExact = headers.findIndex(h => exact.includes(h));
  if (byExact !== -1) return byExact;
  return headers.findIndex(h => contains.some(c => h.includes(c)));
}

export function parseSongsCsv(text: string): ImportResult {
  const rows = parseCsvRows(text).filter(r => !(r[0] || '').trim().startsWith('#'));
  if (rows.length < 2) return { songs: [], skipped: [], error: 'No song rows found under the header row.' };

  const headers = rows[0].map(norm);
  const col = {
    title: findCol(headers, ['title', 'song', 'songtitle', 'songname', 'name'], ['title', 'song']),
    artist: findCol(headers, ['artist', 'band', 'performer'], ['artist']),
    duration: findCol(headers, ['duration', 'length', 'time', 'runtime'], ['duration', 'length']),
    bpm: findCol(headers, ['bpm', 'tempo'], ['bpm', 'tempo']),
    key: findCol(headers, ['key', 'musicalkey', 'songkey'], ['musicalkey']),
    vocalist: findCol(headers, ['vocalist', 'singer', 'lead', 'leadvocal', 'leadvocalist'], ['vocal', 'singer']),
    year: findCol(headers, ['year', 'released', 'releaseyear'], ['year', 'released']),
    lyrics: findCol(headers, ['lyrics', 'lyric', 'chords', 'chart'], ['lyric']),
  };
  if (col.title === -1) {
    return { songs: [], skipped: [], error: 'Could not find a "Title" column. Use the template header row.' };
  }

  const get = (r: string[], i: number) => (i === -1 ? '' : (r[i] ?? '').trim());
  const songs: Song[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    const title = get(r, col.title);
    if (!title) { skipped.push({ row: rowNumber, reason: 'Missing title' }); return; }
    const k = title.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) { skipped.push({ row: rowNumber, reason: `Duplicate in file: ${title}` }); return; }
    seen.add(k);

    const bpm = parseInt(get(r, col.bpm).replace(/[^0-9]/g, ''), 10);
    const year = parseInt(get(r, col.year).replace(/[^0-9]/g, '').slice(0, 4), 10);
    const key = formatKey(get(r, col.key));
    const lyrics = (r[col.lyrics] ?? '').replace(/\r\n/g, '\n').trim();

    songs.push({
      id: uid('csv'),
      title,
      artist: get(r, col.artist) || 'Unknown Artist',
      duration: normalizeDuration(get(r, col.duration)),
      bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined,
      key: key || undefined,
      vocalist: get(r, col.vocalist) || undefined,
      year: Number.isFinite(year) && year > 1000 ? year : undefined,
      lyrics: lyrics || undefined,
      rating: 0,
      isExcludedFromAuto: false,
    });
  });

  return { songs, skipped };
}

export function parseSongsJson(text: string): ImportResult {
  const data = JSON.parse(text);
  const items: any[] = Array.isArray(data) ? data : data.songs || [];
  const songs: Song[] = [];
  const skipped: SkippedRow[] = [];
  items.forEach((item, i) => {
    const title = item.title || item.name || item.Song || item.Title;
    if (!title) { skipped.push({ row: i + 1, reason: 'Missing title' }); return; }
    songs.push({
      id: uid('json'),
      title: String(title),
      artist: item.artist || item.Artist || 'Unknown Artist',
      key: formatKey(item.key || item.Key) || undefined,
      bpm: item.bpm ? parseInt(item.bpm, 10) || undefined : undefined,
      duration: normalizeDuration(item.duration),
      vocalist: item.vocalist || undefined,
      year: item.year ? parseInt(item.year, 10) || undefined : undefined,
      lyrics: item.lyrics || undefined,
      rating: 0,
      isExcludedFromAuto: false,
    });
  });
  return { songs, skipped };
}
