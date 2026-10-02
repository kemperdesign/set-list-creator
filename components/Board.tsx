import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { BoardData, Song, EraPreference, SetlistSnapshot } from '../types';
import SetlistColumn from './SetlistColumn';
import FileUpload, { downloadTemplate } from './FileUpload';
import SongSheet from './SongSheet';
import Sheet from './Sheet';
import ShareBandDialog from './ShareBandDialog';
import { optimizeSetlistFlow, getSongDetails, enrichSongs, describeAiError, smartDistributeSongs } from '../services/geminiService';
import { supabase } from '../lib/supabase';
import { STORAGE_KEY, makeInitialData, normalizeBoard, titleKey, uid } from '../lib/boardData';
import { useDialogs } from '../lib/useDialogs';
import { useIsDesktop } from '../lib/useIsDesktop';
import { COMMON_KEYS, countKeyChanges, formatKey, groupSongIdsByKey } from '../lib/keys';
import { downloadTextFile, exportSongsCsv, normalizeDuration } from '../lib/csv';
import { printSongs } from '../lib/shareSong';
import {
  Disc3, FileText, RotateCcw, Layers, Plus, Wand2, Sparkles, Loader2, Music2, Music, Users2,
  History, Save, Trash2, ChevronLeft, ChevronDown, Menu, Cloud, CloudOff, Wifi, Download,
  Upload, Printer, Share2, LogOut, FileSpreadsheet,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const LOCAL_BAND_ID = 'local';

type SyncStatus = 'loading' | 'syncing' | 'synced' | 'offline' | 'local';

interface BoardProps {
  band: { id: string; name: string; isOwner: boolean };
  userEmail?: string;
  onBack?: () => void;
  onSignOut?: () => void;
}

const SyncBadge: React.FC<{ status: SyncStatus; compact?: boolean }> = ({ status, compact }) => {
  const base = 'flex items-center gap-1 text-[9px] font-bold uppercase';
  if (status === 'local') return <div className={`${base} text-gray-500`} title="Saved on this device only"><CloudOff className="w-3.5 h-3.5" />{!compact && 'Local'}</div>;
  if (status === 'syncing' || status === 'loading') return <div className={`${base} text-indigo-400 animate-pulse`}><Cloud className="w-3.5 h-3.5" />{!compact && 'Saving…'}</div>;
  if (status === 'synced') return <div className={`${base} text-emerald-500`} title="Saved. Bandmates see changes live."><Wifi className="w-3.5 h-3.5" />{!compact && 'Synced'}</div>;
  return <div className={`${base} text-amber-500`} title="Offline - changes are kept on this device and sync when you reconnect"><CloudOff className="w-3.5 h-3.5" />{!compact && 'Offline'}</div>;
};

const Board: React.FC<BoardProps> = ({ band, userEmail, onBack, onSignOut }) => {
  const isLocal = !supabase || band.id === LOCAL_BAND_ID;
  const cacheKey = isLocal ? STORAGE_KEY : `SETLIST_BAND_${band.id}`;
  const isDesktop = useIsDesktop();
  const { showAlert, showConfirm, showPrompt, dialogElement } = useDialogs();

  const [data, setData] = useState<BoardData>(makeInitialData);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [sync, setSync] = useState<SyncStatus>(isLocal ? 'local' : 'loading');

  const [optimizingCol, setOptimizingCol] = useState<string | null>(null);
  const [isSmartPlanning, setIsSmartPlanning] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<string>('pool');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isSnapshotDropdownOpen, setIsSnapshotDropdownOpen] = useState(false);
  const [openSongId, setOpenSongId] = useState<string | null>(null);
  const [newSong, setNewSong] = useState<Partial<Song>>({ title: '', artist: '', vocalist: '', duration: '', key: '' });

  // ── Sync bookkeeping ───────────────────────────────────────────────────────
  const dataRef = useRef(data);
  dataRef.current = data;
  const dirty = useRef(false);            // local edits not yet confirmed saved
  const suppressSave = useRef(false);     // the next data change came from the server, don't echo it back
  const lastStamp = useRef<string | null>(null); // updated_at of the newest server version we know about
  const saveTimer = useRef<number | undefined>(undefined);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cached: BoardData | null = null;
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) cached = normalizeBoard(JSON.parse(raw));
      } catch { /* ignore corrupt cache */ }

      if (isLocal) {
        if (cached) { suppressSave.current = true; setData(cached); }
      } else {
        const { data: row, error } = await supabase!
          .from('setlists')
          .select('data,updated_at')
          .eq('id', band.id)
          .maybeSingle();
        if (cancelled) return;
        suppressSave.current = true;
        if (!error && row) {
          lastStamp.current = row.updated_at;
          setData(normalizeBoard(row.data));
          setSync('synced');
        } else if (cached) {
          // offline: work from the copy cached on this device
          setData(cached);
          setSync('offline');
        } else {
          // Never show (and later save) an empty board just because the network failed.
          setLoadError(error?.message || 'This band could not be found, or you no longer have access.');
          return;
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band.id, reloadTick]);

  // ── Save (debounced) ───────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (isLocal || !supabase || !dirty.current) return;
    window.clearTimeout(saveTimer.current);
    const stamp = new Date().toISOString();
    const payload = dataRef.current;
    lastStamp.current = stamp;
    dirty.current = false;
    const { data: res, error } = await supabase
      .from('setlists')
      .update({ data: payload, updated_at: stamp })
      .eq('id', band.id)
      .select('id');
    if (error || !res || res.length === 0) {
      dirty.current = true;
      setSync('offline');
      return;
    }
    if (dataRef.current === payload) setSync('synced');
  }, [band.id, isLocal]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* storage full/blocked */ }
    if (suppressSave.current) { suppressSave.current = false; return; }
    if (isLocal) return;
    dirty.current = true;
    setSync('syncing');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 700);
  }, [data, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pull in changes from bandmates ─────────────────────────────────────────
  const refetch = useCallback(async () => {
    if (isLocal || !supabase || dirty.current) return;
    const { data: row } = await supabase.from('setlists').select('data,updated_at').eq('id', band.id).maybeSingle();
    if (row && row.updated_at !== lastStamp.current && !dirty.current) {
      lastStamp.current = row.updated_at;
      suppressSave.current = true;
      setData(normalizeBoard(row.data));
      setSync('synced');
    }
  }, [band.id, isLocal]);

  useEffect(() => {
    if (isLocal || !supabase) return;
    const sb = supabase;
    const channel = sb
      .channel(`setlist-${band.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'setlists', filter: `id=eq.${band.id}` },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;
          if (row.updated_at === lastStamp.current) return; // our own save echoing back
          if (!row.data) { refetch(); return; }              // payload was too large to include
          if (dirty.current) return;                         // don't clobber unsaved local edits
          lastStamp.current = row.updated_at;
          suppressSave.current = true;
          setData(normalizeBoard(row.data));
          setSync('synced');
        }
      )
      .subscribe(status => { if (status === 'SUBSCRIBED') refetch(); });
    return () => { sb.removeChannel(channel); };
  }, [band.id, isLocal, refetch]);

  // Phones suspend the page and drop the websocket: save on hide, catch up on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else refetch();
    };
    const onOnline = () => { flush(); refetch(); };
    const onPageHide = () => { flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onPageHide);
      flush();
    };
  }, [flush, refetch]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const setIds = useMemo(() => data.columnOrder.filter(id => id.startsWith('setlist')), [data.columnOrder]);
  const tabs = useMemo(() => ['pool', ...setIds, 'excluded'], [setIds]);
  const tab = tabs.includes(activeTab) ? activeTab : 'pool';
  const hasSongs = Object.keys(data.songs).length > 0;
  const existingTitles = useMemo(() => new Set(Object.values(data.songs).map(s => titleKey(s.title))), [data.songs]);

  const colSongs = (id: string): Song[] =>
    (data.columns[id]?.songIds || []).map(sid => data.songs[sid]).filter((s): s is Song => !!s);

  const filteredLibrary = (): Song[] => {
    const all = colSongs('pool');
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      (s.vocalist && s.vocalist.toLowerCase().includes(q)) ||
      (s.key && formatKey(s.key).toLowerCase() === q)
    );
  };

  const keyChangesFor = (id: string) => countKeyChanges(data.columns[id]?.songIds || [], data.songs);

  const columnOfSong = (songId: string): string | null =>
    Object.keys(data.columns).find(cid => data.columns[cid].songIds.includes(songId)) || null;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const handleDataLoaded = (newSongs: Song[]) => {
    setData(prev => {
      const titles = new Set(Object.values(prev.songs).map(s => titleKey(s.title)));
      const songs = { ...prev.songs };
      const poolIds = [...prev.columns.pool.songIds];
      newSongs.forEach(song => {
        const k = titleKey(song.title);
        if (titles.has(k)) return;
        titles.add(k);
        songs[song.id] = song;
        poolIds.push(song.id);
      });
      return { ...prev, songs, columns: { ...prev.columns, pool: { ...prev.columns.pool, songIds: poolIds } } };
    });
  };

  const handleUpdateSong = (songId: string, updates: Partial<Song>) => {
    setData(prev => (prev.songs[songId]
      ? { ...prev, songs: { ...prev.songs, [songId]: { ...prev.songs[songId], ...updates } } }
      : prev));
  };

  const handleUpdateTargetDuration = (columnId: string, duration: number) => {
    setData(prev => ({
      ...prev,
      columns: { ...prev.columns, [columnId]: { ...prev.columns[columnId], targetDuration: duration } },
    }));
  };

  const moveSong = (songId: string, toColumnId: string) => {
    setData(prev => {
      const columns = { ...prev.columns };
      Object.keys(columns).forEach(cid => {
        if (columns[cid].songIds.includes(songId)) {
          columns[cid] = { ...columns[cid], songIds: columns[cid].songIds.filter(id => id !== songId) };
        }
      });
      columns[toColumnId] = { ...columns[toColumnId], songIds: [...columns[toColumnId].songIds, songId] };
      return { ...prev, columns };
    });
  };

  const deleteSong = async (songId: string) => {
    const song = data.songs[songId];
    if (!song) return;
    const ok = await showConfirm('Delete song', `Delete "${song.title}" from this band? It is removed from every set and the library.`, { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    setOpenSongId(null);
    setData(prev => {
      const { [songId]: _removed, ...songs } = prev.songs;
      const columns = { ...prev.columns };
      Object.keys(columns).forEach(cid => {
        columns[cid] = { ...columns[cid], songIds: columns[cid].songIds.filter(id => id !== songId) };
      });
      return { ...prev, songs, columns };
    });
  };

  const handleGroupKeys = async (columnId: string) => {
    const ids = data.columns[columnId]?.songIds || [];
    if (!ids.some(id => formatKey(data.songs[id]?.key))) {
      await showAlert('No keys yet', 'None of the songs in this set have a key. Tap a song, open Details and add its key (or import a CSV with a Key column).');
      return;
    }
    setData(prev => ({
      ...prev,
      columns: { ...prev.columns, [columnId]: { ...prev.columns[columnId], songIds: groupSongIdsByKey(prev.columns[columnId].songIds, prev.songs) } },
    }));
  };

  const updateSetlistCount = (count: number) => {
    setData(prev => {
      const keys = ['setlistA', 'setlistB', 'setlistC', 'setlistD', 'setlistE'];
      const currentActive = prev.columnOrder.filter(id => id.startsWith('setlist'));
      if (count === currentActive.length) return prev;
      const keep = keys.slice(0, count);
      const columns = { ...prev.columns };
      // songs in sets that are being removed go back to the library instead of disappearing
      const returned: string[] = [];
      keys.forEach(k => {
        if (!keep.includes(k) && columns[k]?.songIds.length) {
          returned.push(...columns[k].songIds);
          columns[k] = { ...columns[k], songIds: [] };
        }
      });
      columns.pool = { ...columns.pool, songIds: [...columns.pool.songIds, ...returned] };
      const columnOrder = [...prev.columnOrder.filter(id => !id.startsWith('setlist')), ...keep];
      return { ...prev, columns, columnOrder };
    });
  };

  // ── Saved set configurations (per band) ────────────────────────────────────
  const saveSnapshot = async () => {
    const name = await showPrompt('Save sets', 'Name this arrangement of sets:', `Sets ${new Date().toLocaleDateString()}`);
    if (!name) return;
    const snap: SetlistSnapshot = {
      id: `snap-${Date.now()}`,
      name,
      timestamp: Date.now(),
      columns: JSON.parse(JSON.stringify(data.columns)),
      columnOrder: [...data.columnOrder],
    };
    setData(prev => ({ ...prev, history: [snap, ...prev.history].slice(0, 20) }));
    await showAlert('Saved!', `"${name}" was saved to this band's history.`);
  };

  const loadSnapshot = async (snap: SetlistSnapshot) => {
    const ok = await showConfirm('Load saved sets', `Load "${snap.name}"? This replaces your current set arrangement (the song library stays).`);
    if (!ok) return;
    setData(prev => ({
      ...prev,
      columns: JSON.parse(JSON.stringify(snap.columns)),
      columnOrder: [...snap.columnOrder],
    }));
    setIsHistoryOpen(false);
    setIsToolsOpen(false);
  };

  const deleteSnapshot = async (id: string) => {
    const ok = await showConfirm('Delete saved sets', 'Delete this saved arrangement? This cannot be undone.', { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    setData(prev => ({ ...prev, history: prev.history.filter(s => s.id !== id) }));
  };

  // ── AI ─────────────────────────────────────────────────────────────────────
  const handleSmartPlan = async () => {
    if (isSmartPlanning) return;
    setIsToolsOpen(false);
    const library = colSongs('pool');
    if (library.length === 0) {
      await showAlert('No songs', 'Add songs to the library first (or move songs back from the sets).');
      return;
    }
    setIsSmartPlanning(true);
    const setDurations: Record<string, number> = {};
    setIds.forEach(id => { if (data.columns[id].targetDuration) setDurations[id] = data.columns[id].targetDuration!; });

    try {
      const plan = await smartDistributeSongs(library, setIds, { ...data.config, setDurations });
      if (Object.keys(plan).length === 0) {
        await showAlert('Could not generate sets', 'The AI did not return a plan. Check your connection and Gemini API key, then try again.');
        return;
      }
      setData(prev => {
        const columns = { ...prev.columns };
        let assigned: string[] = [];
        Object.entries(plan).forEach(([colId, ids]) => {
          if (!columns[colId]) return;
          const ordered = prev.config.groupKeys ? groupSongIdsByKey(ids, prev.songs) : ids;
          columns[colId] = { ...columns[colId], songIds: ordered };
          assigned = [...assigned, ...ordered];
        });
        columns.pool = { ...columns.pool, songIds: prev.columns.pool.songIds.filter(id => !assigned.includes(id)) };
        return { ...prev, columns };
      });
      if (!isDesktop && setIds.length) setActiveTab(setIds[0]);
    } catch (e) {
      console.error('Smart Planning Error:', e);
      await showAlert('Error', 'Failed to generate sets. Please try again.');
    } finally {
      setIsSmartPlanning(false);
    }
  };

  const handleOptimize = useCallback(async (columnId: string) => {
    setOptimizingCol(columnId);
    const col = data.columns[columnId];
    const songs = col.songIds.map(id => data.songs[id]).filter((s): s is Song => !!s);
    try {
      let ids = await optimizeSetlistFlow(songs, { groupKeys: data.config.groupKeys });
      if (data.config.groupKeys) ids = groupSongIdsByKey(ids, data.songs);
      setData(prev => ({ ...prev, columns: { ...prev.columns, [columnId]: { ...prev.columns[columnId], songIds: ids } } }));
    } catch (e) {
      console.error(e);
    } finally {
      setOptimizingCol(null);
    }
  }, [data]);

  // Keeps only the fields that are currently empty, and only values that look valid.
  const pickMissing = (song: Partial<Song>, found: Partial<Song>): Partial<Song> => {
    const out: Partial<Song> = {};
    const artist = (found.artist || '').trim();
    if (artist && (!song.artist || song.artist.trim() === '' || /^unknown artist$/i.test(song.artist.trim()))) out.artist = artist;
    const key = formatKey(found.key);
    if (key && !formatKey(song.key)) out.key = key;
    const bpm = Math.round(Number(found.bpm));
    if (!song.bpm && bpm >= 30 && bpm <= 300) out.bpm = bpm;
    const dur = normalizeDuration(found.duration);
    if (dur && !song.duration) out.duration = dur;
    const year = Math.round(Number(found.year));
    if (!song.year && year >= 1900 && year <= 2035) out.year = year;
    return out;
  };

  const hasGaps = (s: Song) =>
    !s.artist || /^unknown artist$/i.test(s.artist.trim()) || !formatKey(s.key) || !s.bpm || !s.duration || !s.year;

  /** AI fill for the Add Song form: only touches fields you left empty. */
  const handleMagicScan = async () => {
    if (!newSong.title?.trim()) {
      await showAlert('Enter a title first', 'Type the song title, then tap the sparkle to fill in the rest.');
      return;
    }
    setIsScanning(true);
    try {
      const found = await getSongDetails(newSong.title.trim(), newSong.artist?.trim());
      const fill = pickMissing(newSong, found);
      if (Object.keys(fill).length === 0) {
        await showAlert('Nothing to fill in', 'The AI had nothing new to add. Either every field is already filled in or it was not confident about this song.');
      } else {
        setNewSong(prev => ({ ...prev, ...fill }));
      }
    } catch (error) {
      await showAlert('AI fill failed', error instanceof Error ? error.message : describeAiError(error));
    } finally { setIsScanning(false); }
  };

  /** AI fill for one song already in the library. Returns the updates so the sheet can show them. */
  const autoFillSong = async (songId: string): Promise<{ updates: Partial<Song>; error?: string }> => {
    const song = data.songs[songId];
    if (!song) return { updates: {} };
    const res = await enrichSongs([{ id: songId, title: song.title, artist: song.artist, key: song.key, bpm: song.bpm, duration: song.duration, year: song.year }]);
    if (res.error && !res.updates[songId]) return { updates: {}, error: res.error };
    const updates = pickMissing(song, res.updates[songId] || {});
    if (Object.keys(updates).length) handleUpdateSong(songId, updates);
    return { updates };
  };

  /** AI fill for every song that has gaps. */
  const fillMissingData = async () => {
    setIsToolsOpen(false);
    const targets = Object.values(data.songs).filter(hasGaps);
    if (targets.length === 0) {
      await showAlert('Nothing missing', 'Every song already has an artist, key, BPM, length and year.');
      return;
    }
    const ok = await showConfirm('Fill missing data with AI', `Look up artist, key, BPM, length and year for ${targets.length} song${targets.length === 1 ? '' : 's'}? Only empty fields are filled; nothing you typed is overwritten. AI can be wrong, so give the keys a quick check.`, { confirmLabel: 'Fill in' });
    if (!ok) return;
    setIsEnriching(true);
    try {
      const res = await enrichSongs(targets.map(s => ({ id: s.id, title: s.title, artist: s.artist, key: s.key, bpm: s.bpm, duration: s.duration, year: s.year })));
      let changed = 0;
      setData(prev => {
        const songs = { ...prev.songs };
        Object.entries(res.updates).forEach(([id, found]) => {
          const cur = songs[id];
          if (!cur) return;
          const fill = pickMissing(cur, found);
          if (Object.keys(fill).length) { songs[id] = { ...cur, ...fill }; changed++; }
        });
        return { ...prev, songs };
      });
      const failedNote = res.failed ? `\n\n${res.failed} song${res.failed === 1 ? '' : 's'} could not be looked up: ${res.error}` : '';
      await showAlert(changed ? 'Songs updated' : 'No changes', `${changed} of ${targets.length} song${targets.length === 1 ? '' : 's'} got new details.${failedNote}`);
    } finally {
      setIsEnriching(false);
    }
  };

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    // While searching, the library shows only some songs, so the indexes react-dnd reports are
    // positions in the filtered list. Translate them back to real positions.
    const visiblePool = searchQuery.trim() ? filteredLibrary().map(s => s.id) : null;

    setData(prev => {
      const start = prev.columns[source.droppableId];
      const finish = prev.columns[destination.droppableId];
      if (!start || !finish) return prev;

      const realSource = start.songIds.indexOf(draggableId);
      if (realSource === -1) return prev;

      const realDest = (() => {
        if (finish.id !== 'pool' || !visiblePool) return destination.index;
        const others = visiblePool.filter(id => id !== draggableId);
        const anchor = others[destination.index];
        if (anchor) return Math.max(0, finish.songIds.filter(id => id !== draggableId).indexOf(anchor));
        const last = others[others.length - 1];
        return last ? finish.songIds.filter(id => id !== draggableId).indexOf(last) + 1 : finish.songIds.length;
      })();

      if (start === finish) {
        const ids = Array.from(start.songIds);
        ids.splice(realSource, 1);
        ids.splice(realDest, 0, draggableId);
        return { ...prev, columns: { ...prev.columns, [start.id]: { ...start, songIds: ids } } };
      }
      const startIds = Array.from(start.songIds);
      startIds.splice(realSource, 1);
      const finishIds = Array.from(finish.songIds);
      finishIds.splice(realDest, 0, draggableId);
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [start.id]: { ...start, songIds: startIds },
          [finish.id]: { ...finish, songIds: finishIds },
        },
      };
    });
  };

  // ── Export / print ─────────────────────────────────────────────────────────
  const handleExportPDF = () => {
    setIsToolsOpen(false);
    // Only the sets: never the Song Library or the Do Not Play list.
    const filledSetIds = setIds.filter(id => (data.columns[id]?.songIds || []).some(sid => data.songs[sid]));
    if (filledSetIds.length === 0) {
      showAlert('No sets to print', 'None of your sets have songs yet. Drag songs into a set or tap Generate Sets first.');
      return;
    }
    const doc = new jsPDF();
    doc.setFontSize(20); doc.text(`${band.name} - Set Lists`, 14, 20);
    let y = 32;
    filledSetIds.forEach(id => {
      const col = data.columns[id];
      const songs = col.songIds.map(sid => data.songs[sid]).filter(Boolean) as Song[];
      if (y > 250) { doc.addPage(); y = 20; }
      const mins = Math.round(songs.reduce((sum, s) => {
        const m = /^(\d+):(\d{2})$/.exec(s.duration || '');
        return sum + (m ? Number(m[1]) + Number(m[2]) / 60 : 3.5);
      }, 0));
      doc.setFontSize(14); doc.text(`${col.title} - ${songs.length} songs - about ${mins} min`, 14, y);
      y += 5;
      const body = songs.map((s, i) => [i + 1, s.title, s.artist, formatKey(s.key) || '-', s.duration || '-', s.bpm || '-', s.vocalist || '-', s.year || '-']);
      autoTable(doc, { startY: y, head: [['#', 'Song', 'Artist', 'Key', 'Duration', 'BPM', 'Vocalist', 'Year']], body });
      // @ts-ignore
      y = doc.lastAutoTable.finalY + 15;
    });
    doc.save(`${band.name.replace(/[^\w-]+/g, '_')}-Setlist-${Date.now()}.pdf`);
  };

  const handleExportCsv = () => {
    setIsToolsOpen(false);
    downloadTextFile(`${band.name.replace(/[^\w-]+/g, '_')}-songs.csv`, exportSongsCsv(Object.values(data.songs)));
  };

  const printSetLyrics = async () => {
    setIsToolsOpen(false);
    const ordered = setIds.flatMap(id => colSongs(id)).filter(s => s.lyrics);
    if (ordered.length === 0) {
      await showAlert('No lyrics to print', 'None of the songs in your sets have lyrics yet. Tap a song to add them.');
      return;
    }
    printSongs(ordered, false, 15);
  };

  const handleReset = async () => {
    setIsToolsOpen(false);
    const ok = await showConfirm(
      'Reset band',
      `Clear the whole library, lyrics and sets for "${band.name}"?${isLocal ? '' : ' Everyone who shares this band will see it cleared.'} This cannot be undone.`,
      { danger: true, confirmLabel: 'Reset' }
    );
    if (ok) setData(makeInitialData());
  };

  const openSong = openSongId ? data.songs[openSongId] : undefined;
  const openSongColumn = openSongId ? columnOfSong(openSongId) : null;
  const siblings = openSongColumn ? data.columns[openSongColumn].songIds : [];
  const openIdx = openSongId ? siblings.indexOf(openSongId) : -1;
  const destinations = [
    { id: 'pool', title: 'Song Library' },
    ...setIds.map(id => ({ id, title: data.columns[id].title })),
    { id: 'excluded', title: 'Do Not Play' },
  ];

  if (loadError) {
    return (
      <div className="h-[100dvh] bg-gray-950 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-gray-200 font-semibold">Couldn't open "{band.name}"</p>
        <p className="text-sm text-gray-500 max-w-sm">{loadError}</p>
        <div className="flex gap-2">
          {onBack && <button onClick={onBack} className="px-4 py-2.5 text-xs font-black uppercase bg-gray-800 text-gray-200 rounded-lg">Back</button>}
          <button onClick={() => { setLoadError(null); setReloadTick(t => t + 1); }} className="px-4 py-2.5 text-xs font-black uppercase bg-indigo-600 text-white rounded-lg">Try again</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="h-[100dvh] bg-gray-950 flex items-center justify-center text-gray-500 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading band…</div>;
  }

  const btn = 'flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border border-gray-700 uppercase flex-shrink-0';
  const input = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:ring-1 focus:ring-indigo-500 outline-none';
  const label = 'text-[9px] font-black text-gray-500 uppercase mb-1 block';

  const settingsControls = (
    <>
      <label className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 border border-gray-700">
        <Music2 className="w-3 h-3 text-indigo-400" />
        <span className="text-[9px] font-bold text-gray-300">TEMPOS</span>
        <input type="checkbox" checked={data.config.mixTempos} onChange={e => setData(prev => ({ ...prev, config: { ...prev.config, mixTempos: e.target.checked } }))} className="w-3.5 h-3.5 rounded" />
      </label>
      <label className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 border border-gray-700">
        <Users2 className="w-3 h-3 text-indigo-400" />
        <span className="text-[9px] font-bold text-gray-300">SINGERS</span>
        <input type="checkbox" checked={data.config.separateSingers} onChange={e => setData(prev => ({ ...prev, config: { ...prev.config, separateSingers: e.target.checked } }))} className="w-3.5 h-3.5 rounded" />
      </label>
      <label className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 border border-gray-700" title="Keep songs in the same key together to reduce instrument changes">
        <Music className="w-3 h-3 text-fuchsia-400" />
        <span className="text-[9px] font-bold text-gray-300">GROUP KEYS</span>
        <input type="checkbox" checked={!!data.config.groupKeys} onChange={e => setData(prev => ({ ...prev, config: { ...prev.config, groupKeys: e.target.checked } }))} className="w-3.5 h-3.5 rounded" />
      </label>
    </>
  );

  const eraControl = (
    <div className="flex p-0.5 bg-gray-800 rounded-lg border border-gray-700">
      {['old', 'new', 'mixed'].map(e => (
        <button
          key={e}
          onClick={() => setData(prev => ({ ...prev, config: { ...prev.config, era: e as EraPreference } }))}
          className={`px-3 py-1.5 text-[9px] font-black uppercase rounded transition-all ${data.config.era === e ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
        >
          {e}
        </button>
      ))}
    </div>
  );

  const setCountSelect = (
    <div className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2 py-1.5 border border-gray-700">
      <Layers className="w-3 h-3 text-indigo-400" />
      <select value={setIds.length} onChange={e => updateSetlistCount(Number(e.target.value))} className="bg-transparent text-white text-[11px] font-bold rounded focus:outline-none">
        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} SET{n > 1 ? 'S' : ''}</option>)}
      </select>
    </div>
  );

  // ── Desktop toolbar ────────────────────────────────────────────────────────
  const desktopToolbar = hasSongs && (
    <div className="mb-3 bg-gray-900/80 p-1.5 rounded-xl border border-indigo-500/20 shadow-lg flex flex-wrap items-center gap-x-3 gap-y-2 flex-shrink-0">
      <div className="flex items-center gap-2 pr-3 border-r border-gray-800 flex-shrink-0">
        <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
        <h3 className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Smart Planner</h3>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">{settingsControls}{eraControl}</div>
      <div className="flex items-center gap-1.5 border-l border-r border-gray-800 px-3">
        {setCountSelect}
        <button onClick={saveSnapshot} className={`${btn} text-indigo-400`}><Save className="w-3 h-3" /> Save</button>
        <button onClick={() => setIsHistoryOpen(true)} className={`${btn} text-amber-400`}><History className="w-3 h-3" /> History</button>
        <button onClick={() => setIsImportOpen(true)} className={`${btn} text-emerald-400`}><Upload className="w-3 h-3" /> Import</button>
        <button onClick={downloadTemplate} className={`${btn} text-emerald-400`}><Download className="w-3 h-3" /> Template</button>
        <button onClick={handleExportCsv} className={`${btn} text-gray-300`}><FileSpreadsheet className="w-3 h-3" /> CSV</button>
        <button onClick={fillMissingData} disabled={isEnriching} className={`${btn} text-indigo-300 disabled:opacity-50`} title="Use AI to fill in missing artist, key, BPM, length and year">
          {isEnriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI Fill
        </button>
        <button onClick={handleExportPDF} className={`${btn} text-red-400`}><FileText className="w-3 h-3" /> PDF</button>
        <button onClick={printSetLyrics} className={`${btn} text-sky-400`}><Printer className="w-3 h-3" /> Lyrics</button>
        <button onClick={handleReset} className={`${btn} text-gray-400 hover:!bg-red-900/30`}><RotateCcw className="w-3 h-3" /> Reset</button>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleSmartPlan}
          disabled={isSmartPlanning}
          className="px-4 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-black text-[9px] uppercase shadow-lg shadow-indigo-500/10 flex items-center gap-1.5 disabled:opacity-50"
        >
          {isSmartPlanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Generate Sets
        </button>
        <div className="relative">
          <button
            onClick={() => setIsSnapshotDropdownOpen(!isSnapshotDropdownOpen)}
            disabled={data.history.length === 0}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-indigo-400 rounded-lg font-black text-[9px] uppercase border border-gray-700 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronDown className="w-3 h-3" /> Saved
          </button>
          {isSnapshotDropdownOpen && data.history.length > 0 && (
            <div className="absolute top-full right-0 mt-1 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-40 max-h-64 overflow-y-auto">
              {data.history.map(snap => (
                <button
                  key={snap.id}
                  onClick={() => { loadSnapshot(snap); setIsSnapshotDropdownOpen(false); }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 border-b border-gray-800 last:border-b-0"
                >
                  <p className="text-xs font-semibold text-white truncate">{snap.name}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{new Date(snap.timestamp).toLocaleDateString()}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const columnProps = (id: string) => ({
    column: data.columns[id],
    songs: id === 'pool' ? filteredLibrary() : colSongs(id),
    onOptimize: handleOptimize,
    isOptimizing: optimizingCol === id,
    onUpdateSong: handleUpdateSong,
    onOpenSong: setOpenSongId,
    onDeleteSong: deleteSong,
    mobile: !isDesktop,
    ...(id.startsWith('setlist')
      ? { onUpdateTargetDuration: handleUpdateTargetDuration, onGroupKeys: handleGroupKeys, keyChanges: keyChangesFor(id) }
      : {}),
    ...(id === 'pool' ? { onAddSong: () => setIsAddOpen(true) } : {}),
  });

  // ── Desktop body ───────────────────────────────────────────────────────────
  const desktopBoard = (
    <PanelGroup direction="horizontal" className="flex-1 overflow-hidden h-full">
      <Panel defaultSize={25} minSize={15} maxSize={40} className="flex flex-col gap-4 overflow-hidden">
        <input
          type="text"
          placeholder="Search songs, artists, keys…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-1 focus:ring-indigo-500 outline-none"
        />
        <PanelGroup direction="vertical" className="flex-1 overflow-hidden min-h-0">
          <Panel defaultSize={60} minSize={20} maxSize={80} className="overflow-hidden">
            <SetlistColumn {...columnProps('pool')} className="h-full" />
          </Panel>
          <PanelResizeHandle className="h-1 bg-gray-800 hover:bg-indigo-500 transition-colors" />
          <Panel defaultSize={40} minSize={15} maxSize={80} className="overflow-hidden">
            <SetlistColumn {...columnProps('excluded')} className="h-full" />
          </Panel>
        </PanelGroup>
      </Panel>

      <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-indigo-500 transition-colors" />

      <Panel defaultSize={75} minSize={60} className="overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
        <div className="flex gap-6 h-full items-start">
          {setIds.map(id => (
            <SetlistColumn key={id} {...columnProps(id)} className="w-80 flex-shrink-0 h-full max-h-full" />
          ))}
        </div>
      </Panel>
    </PanelGroup>
  );

  // ── Mobile body: one column at a time + bottom tab bar ─────────────────────
  const mobileBoard = (
    <>
      <div className="flex-1 min-h-0 flex flex-col px-2 pt-2 gap-2">
        {tab === 'pool' && (
          <input
            type="search"
            placeholder="Search songs, artists, keys…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:ring-1 focus:ring-indigo-500 outline-none flex-shrink-0"
          />
        )}
        <div className="flex-1 min-h-0">
          <SetlistColumn key={tab} {...columnProps(tab)} className="h-full" />
        </div>
      </div>
      <nav
        className="flex-shrink-0 border-t border-gray-800 bg-gray-950 overflow-x-auto no-scrollbar flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map(id => {
          const col = data.columns[id];
          const active = tab === id;
          const name = id === 'pool' ? 'Library' : id === 'excluded' ? 'Excluded' : col.title;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 min-w-[76px] px-3 py-2.5 flex flex-col items-center gap-0.5 border-t-2 transition-colors ${active ? 'border-indigo-500 text-white bg-gray-900' : 'border-transparent text-gray-500'}`}
            >
              <span className="text-xs font-bold whitespace-nowrap">{name}</span>
              <span className="text-[10px] font-mono text-gray-500">{col.songIds.length}</span>
            </button>
          );
        })}
      </nav>
    </>
  );

  return (
    <div
      className="bg-gray-950 text-gray-100 flex flex-col h-[100dvh] overflow-hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {dialogElement}

      <header className={`flex items-center justify-between gap-2 border-b border-gray-800 flex-shrink-0 ${isDesktop ? 'px-6 pt-4 pb-3 mb-3 mx-0' : 'px-2 py-2'}`}>
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button onClick={onBack} aria-label="Back to bands" className="flex items-center gap-1 p-2 -ml-1 text-gray-300 hover:text-white rounded-lg hover:bg-gray-900">
              <ChevronLeft className="w-5 h-5" />{isDesktop && <span className="text-xs font-bold uppercase">Bands</span>}
            </button>
          )}
          {isDesktop && (
            <div className="p-2 bg-indigo-600 rounded-xl shadow-lg"><Disc3 className="w-5 h-5 text-white animate-spin-slow" /></div>
          )}
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-white tracking-tight truncate leading-tight">{band.name}</h1>
            {isDesktop && <p className="text-gray-400 text-[9px] uppercase font-bold tracking-widest leading-none">Intelligent Live Planning</p>}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <SyncBadge status={sync} compact={!isDesktop} />
          {isDesktop ? (
            <>
              {!isLocal && band.isOwner && (
                <button onClick={() => setIsShareOpen(true)} className={`${btn} text-indigo-300 ml-2`}><Share2 className="w-3 h-3" /> Share</button>
              )}
              {onSignOut && (
                <button onClick={onSignOut} className={`${btn} text-gray-400`} title={userEmail}><LogOut className="w-3 h-3" /> Sign out</button>
              )}
            </>
          ) : (
            <>
              {hasSongs && (
                <button onClick={handleSmartPlan} disabled={isSmartPlanning} aria-label="Generate sets" className="p-2.5 text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg disabled:opacity-50">
                  {isSmartPlanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </button>
              )}
              <button onClick={() => setIsAddOpen(true)} aria-label="Add song" className="p-2.5 text-indigo-300 bg-gray-900 border border-gray-800 rounded-lg"><Plus className="w-4 h-4" /></button>
              <button onClick={() => setIsToolsOpen(true)} aria-label="Menu" className="p-2.5 text-indigo-300 bg-gray-900 border border-gray-800 rounded-lg"><Menu className="w-4 h-4" /></button>
            </>
          )}
        </div>
      </header>

      <DragDropContext onDragEnd={onDragEnd}>
        {!hasSongs ? (
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 flex flex-col items-center justify-center">
            <FileUpload onDataLoaded={handleDataLoaded} existingTitles={existingTitles} />
          </div>
        ) : isDesktop ? (
          <div className="flex-1 min-h-0 flex flex-col px-6 pb-4">
            {desktopToolbar}
            {desktopBoard}
          </div>
        ) : (
          mobileBoard
        )}
      </DragDropContext>

      {/* Song: lyrics / details / move / print / email / text */}
      {openSong && (
        <SongSheet
          key={openSong.id}
          song={openSong}
          currentColumnId={openSongColumn || 'pool'}
          destinations={destinations}
          prevId={openIdx > 0 ? siblings[openIdx - 1] : undefined}
          nextId={openIdx >= 0 && openIdx < siblings.length - 1 ? siblings[openIdx + 1] : undefined}
          positionLabel={openIdx >= 0 ? `${openIdx + 1} / ${siblings.length}` : undefined}
          onNavigate={setOpenSongId}
          onUpdate={handleUpdateSong}
          onMove={moveSong}
          onDelete={deleteSong}
          onAutoFill={autoFillSong}
          onClose={() => setOpenSongId(null)}
        />
      )}

      {/* Phone menu */}
      {isToolsOpen && (
        <Sheet title="Menu" onClose={() => setIsToolsOpen(false)}>
          <div className="p-4 space-y-5">
            <section className="space-y-2">
              <p className={label}>Smart planner</p>
              <div className="flex flex-wrap gap-2">{settingsControls}</div>
              <div className="flex items-center gap-2 flex-wrap">{eraControl}{setCountSelect}</div>
              <button onClick={handleSmartPlan} disabled={isSmartPlanning || !hasSongs} className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2 disabled:opacity-50">
                {isSmartPlanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Generate sets
              </button>
            </section>

            <section className="grid grid-cols-2 gap-2">
              {[
                { icon: <Save className="w-4 h-4 text-indigo-400" />, text: 'Save sets', on: () => { setIsToolsOpen(false); saveSnapshot(); } },
                { icon: <History className="w-4 h-4 text-amber-400" />, text: 'History', on: () => { setIsToolsOpen(false); setIsHistoryOpen(true); } },
                { icon: <Upload className="w-4 h-4 text-emerald-400" />, text: 'Import songs', on: () => { setIsToolsOpen(false); setIsImportOpen(true); } },
                { icon: <Download className="w-4 h-4 text-emerald-400" />, text: 'CSV template', on: () => { setIsToolsOpen(false); downloadTemplate(); } },
                { icon: <FileSpreadsheet className="w-4 h-4 text-gray-300" />, text: 'Export CSV', on: handleExportCsv },
                { icon: <Sparkles className="w-4 h-4 text-indigo-300" />, text: 'AI fill missing data', on: fillMissingData },
                { icon: <FileText className="w-4 h-4 text-red-400" />, text: 'Export PDF (sets only)', on: handleExportPDF },
                { icon: <Printer className="w-4 h-4 text-sky-400" />, text: 'Print lyrics', on: printSetLyrics },
                ...(!isLocal && band.isOwner ? [{ icon: <Share2 className="w-4 h-4 text-indigo-300" />, text: 'Share band', on: () => { setIsToolsOpen(false); setIsShareOpen(true); } }] : []),
                { icon: <RotateCcw className="w-4 h-4 text-gray-400" />, text: 'Reset band', on: handleReset },
              ].map(a => (
                <button key={a.text} onClick={a.on} className="py-3 px-3 flex items-center gap-2 text-xs font-bold text-gray-100 bg-gray-800 hover:bg-gray-700 rounded-xl text-left">
                  {a.icon}{a.text}
                </button>
              ))}
            </section>

            <section className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-800">
              {onBack && <button onClick={() => { setIsToolsOpen(false); onBack(); }} className="py-3 text-xs font-black uppercase text-gray-200 bg-gray-800 rounded-xl">Switch band</button>}
              {onSignOut && <button onClick={onSignOut} className="py-3 text-xs font-black uppercase text-gray-400 bg-gray-800 rounded-xl flex items-center justify-center gap-1.5"><LogOut className="w-3.5 h-3.5" />Sign out</button>}
            </section>
          </div>
        </Sheet>
      )}

      {isShareOpen && <ShareBandDialog bandId={band.id} bandName={band.name} onClose={() => setIsShareOpen(false)} />}

      {isImportOpen && (
        <Sheet title="Import songs" onClose={() => setIsImportOpen(false)}>
          <div className="p-3">
            <FileUpload
              hideSample
              existingTitles={existingTitles}
              onDataLoaded={handleDataLoaded}
              onDone={() => setIsImportOpen(false)}
            />
          </div>
        </Sheet>
      )}

      {/* Add song */}
      {isAddOpen && (
        <Sheet
          title={<><Plus className="w-4 h-4 text-indigo-500" /> New song</>}
          onClose={() => { setIsAddOpen(false); setNewSong({ title: '', artist: '', vocalist: '', duration: '', key: '' }); }}
        >
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (existingTitles.has(titleKey(newSong.title || ''))) {
                await showAlert('Duplicate song', `"${newSong.title}" is already in this band's library.`);
                return;
              }
              handleDataLoaded([{
                ...newSong,
                key: formatKey(newSong.key) || undefined,
                duration: normalizeDuration(newSong.duration),
                artist: newSong.artist?.trim() || 'Unknown Artist',
                id: uid('manual'),
                rating: 0,
                isExcludedFromAuto: false,
              } as Song]);
              setNewSong({ title: '', artist: '', vocalist: '', duration: '', key: '' });
              setIsAddOpen(false);
            }}
            className="p-4 space-y-4"
          >
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className={label}>Title</label>
                <input required className={input} value={newSong.title} onChange={e => setNewSong({ ...newSong, title: e.target.value })} />
              </div>
              <button type="button" onClick={handleMagicScan} className="h-[46px] px-3 bg-indigo-600 rounded-lg hover:bg-indigo-500 shadow-lg shadow-indigo-600/20" title="AI magic scan: fill artist, key, BPM, year">
                {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Artist</label>
                <input className={input} value={newSong.artist} onChange={e => setNewSong({ ...newSong, artist: e.target.value })} />
              </div>
              <div>
                <label className={label}>Key</label>
                <input className={input} list="new-song-keys" placeholder="G, F#m, Bb" autoCapitalize="characters" value={newSong.key || ''} onChange={e => setNewSong({ ...newSong, key: e.target.value })} />
                <datalist id="new-song-keys">{COMMON_KEYS.map(k => <option key={k} value={k} />)}</datalist>
              </div>
              <div>
                <label className={label}>Duration (M:SS)</label>
                <input className={input} placeholder="3:45" value={newSong.duration || ''} onChange={e => setNewSong({ ...newSong, duration: e.target.value })} />
              </div>
              <div>
                <label className={label}>BPM</label>
                <input className={input} inputMode="numeric" placeholder="120" value={newSong.bpm || ''} onChange={e => setNewSong({ ...newSong, bpm: parseInt(e.target.value) || undefined })} />
              </div>
              <div>
                <label className={label}>Year</label>
                <input className={input} inputMode="numeric" value={newSong.year || ''} onChange={e => setNewSong({ ...newSong, year: parseInt(e.target.value) || undefined })} />
              </div>
              <div>
                <label className={label}>Vocalist</label>
                <input className={input} value={newSong.vocalist || ''} onChange={e => setNewSong({ ...newSong, vocalist: e.target.value })} />
              </div>
            </div>
            <button type="submit" className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-xs uppercase shadow-lg shadow-indigo-600/20">
              Add to library
            </button>
            <p className="text-[11px] text-gray-500 text-center">Add lyrics afterwards by tapping the song.</p>
          </form>
        </Sheet>
      )}

      {/* History */}
      {isHistoryOpen && (
        <Sheet title={<><History className="w-4 h-4 text-amber-500" /> Saved sets</>} onClose={() => setIsHistoryOpen(false)} wide>
          <div className="p-4 space-y-3">
            {data.history.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-gray-400 text-sm">Nothing saved yet.</p>
                <p className="text-gray-600 text-xs mt-1">Use "Save sets" to keep a snapshot of your current sets for this band.</p>
              </div>
            ) : data.history.map(snap => (
              <div key={snap.id} className="bg-gray-800 border border-gray-700 p-3 rounded-xl flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-bold text-white text-sm truncate">{snap.name}</h4>
                  <p className="text-[11px] text-gray-500 mt-0.5">{new Date(snap.timestamp).toLocaleString()}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {snap.columnOrder.filter(id => id.startsWith('setlist')).map(cid => (
                      <span key={cid} className="px-1.5 py-0.5 bg-gray-900 rounded text-[10px] font-mono text-gray-400">{snap.columns[cid]?.songIds.length ?? 0} songs</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => loadSnapshot(snap)} className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-black uppercase rounded-lg">Load</button>
                  <button onClick={() => deleteSnapshot(snap.id)} aria-label="Delete" className="p-2.5 text-gray-500 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
};

export default Board;
