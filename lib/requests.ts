import { BoardData } from '../types';
import requestsSql from '../supabase/requests.sql?raw';

export const REQUEST_ORIGIN = 'https://requests.auggystyle.com';
export const REQUESTS_SQL = requestsSql as string;

export interface SongRequest {
  id: string;
  setlist_id: string;
  song_id: string | null;
  title: string;
  artist: string | null;
  requester: string | null;
  note: string | null;
  status: 'new' | 'played' | 'dismissed';
  created_at: string;
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters

export const makeRequestCode = (len = 6) =>
  Array.from({ length: len }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

export const requestUrl = (code: string) => `${REQUEST_ORIGIN}/${code}`;
/** Works immediately on the app's own address, before the requests.auggystyle.com domain is set up. */
export const fallbackRequestUrl = (code: string) => `${window.location.origin}/r/${code}`;

/** What the audience may pick from: the library and the sets, never the Do Not Play list. */
export const publicSongList = (data: BoardData): { id: string; t: string; a: string }[] => {
  const ids = new Set<string>();
  Object.keys(data.columns).filter(c => c !== 'excluded').forEach(c => data.columns[c].songIds.forEach(id => ids.add(id)));
  return [...ids]
    .map(id => data.songs[id])
    .filter(Boolean)
    .map(s => ({ id: s.id, t: s.title, a: s.artist === 'Unknown Artist' ? '' : s.artist }))
    .sort((x, y) => x.t.localeCompare(y.t, undefined, { sensitivity: 'base', numeric: true }));
};

/** Groups identical requests so the band sees "Song (3)" instead of three rows. */
export const groupRequests = (list: SongRequest[]) => {
  const map = new Map<string, { key: string; title: string; artist: string | null; count: number; names: string[]; notes: string[]; ids: string[]; latest: string }>();
  list.forEach(r => {
    const key = (r.title + '|' + (r.artist || '')).toLowerCase();
    const g = map.get(key) || { key, title: r.title, artist: r.artist, count: 0, names: [], notes: [], ids: [], latest: r.created_at };
    g.count += 1;
    g.ids.push(r.id);
    if (r.requester) g.names.push(r.requester);
    if (r.note) g.notes.push(r.note);
    if (r.created_at > g.latest) g.latest = r.created_at;
    map.set(key, g);
  });
  return [...map.values()].sort((a, b) => b.count - a.count || (a.latest < b.latest ? 1 : -1));
};
