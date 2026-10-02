import { BoardData } from '../types';

/** Legacy single-device storage key (also used for local-only mode). */
export const STORAGE_KEY = 'SETLIST_GEN_V1';

export const makeInitialData = (): BoardData => ({
  songs: {},
  columns: {
    pool: { id: 'pool', title: 'Song Library', songIds: [], color: 'border-gray-500', className: 'h-[400px]' },
    excluded: { id: 'excluded', title: 'Do Not Play', songIds: [], color: 'border-red-900', className: 'h-48' },
    setlistA: { id: 'setlistA', title: 'Set 1', songIds: [], color: 'border-emerald-500', targetDuration: 45 },
    setlistB: { id: 'setlistB', title: 'Set 2', songIds: [], color: 'border-blue-500', targetDuration: 45 },
    setlistC: { id: 'setlistC', title: 'Set 3', songIds: [], color: 'border-purple-500', targetDuration: 45 },
    setlistD: { id: 'setlistD', title: 'Set 4', songIds: [], color: 'border-pink-500', targetDuration: 45 },
    setlistE: { id: 'setlistE', title: 'Encore', songIds: [], color: 'border-orange-500', targetDuration: 15 },
  },
  columnOrder: ['pool', 'excluded', 'setlistA', 'setlistB'],
  history: [],
  config: { mixTempos: true, separateSingers: true, era: 'mixed' },
});

/** Merge whatever came out of the database / localStorage onto a complete default board. */
export const normalizeBoard = (raw: any): BoardData => {
  const base = makeInitialData();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    songs: raw.songs && typeof raw.songs === 'object' ? raw.songs : {},
    columns: { ...base.columns, ...(raw.columns || {}) },
    columnOrder: Array.isArray(raw.columnOrder) && raw.columnOrder.length ? raw.columnOrder : base.columnOrder,
    history: Array.isArray(raw.history) ? raw.history : [],
    config: { ...base.config, ...(raw.config || {}) },
  };
};

export const uid = (prefix = 's') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Case/whitespace-insensitive key used for duplicate detection. */
export const titleKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

export const countSongs = (data?: Partial<BoardData> | null) =>
  data && data.songs ? Object.keys(data.songs).length : 0;

export const countSets = (data?: Partial<BoardData> | null) =>
  data && Array.isArray(data.columnOrder) ? data.columnOrder.filter(id => id.startsWith('setlist')).length : 0;

export const timeAgo = (iso?: string) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};
