
import React, { useState, useCallback, useLayoutEffect, useEffect } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { BoardData, Song, GeneratorConfig, EraPreference, SetlistSnapshot } from './types';
import SetlistColumn from './components/SetlistColumn';
import FileUpload from './components/FileUpload';
import { optimizeSetlistFlow, getSongDetails, smartDistributeSongs } from './services/geminiService';
import { 
  Disc3, FileSpreadsheet, FileText, RotateCcw, Layers, FileJson, X, Plus, 
  Wand2, Sparkles, Loader2, Music2, Users2, History, Save, Trash2, CheckCircle2,
  ChevronLeft, ChevronRight, Menu
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const STORAGE_KEY = 'SETLIST_GEN_V1';

const initialData: BoardData = {
  songs: {},
  columns: {
    pool: { id: 'pool', title: 'Song Library', songIds: [], color: 'border-gray-500', className: 'h-[400px]' },
    excluded: { id: 'excluded', title: 'Do Not Play', songIds: [], color: 'border-red-900', className: 'h-48' },
    setlistA: { id: 'setlistA', title: 'Set 1', songIds: [], color: 'border-emerald-500', targetDuration: 45 },
    setlistB: { id: 'setlistB', title: 'Set 2', songIds: [], color: 'border-blue-500', targetDuration: 45 },
    setlistC: { id: 'setlistC', title: 'Set 3', songIds: [], color: 'border-purple-500', targetDuration: 45 },
    setlistD: { id: 'setlistD', title: 'Set 4', songIds: [], color: 'border-pink-500', targetDuration: 45 },
    setlistE: { id: 'setlistE', title: 'Encore', songIds: [], color: 'border-orange-500', targetDuration: 15 }
  },
  columnOrder: ['pool', 'excluded', 'setlistA', 'setlistB'],
  history: [],
  config: {
    mixTempos: true,
    separateSingers: true,
    era: 'mixed'
  }
};

const App: React.FC = () => {
  const [data, setData] = useState<BoardData>(initialData);
  const [optimizingCol, setOptimizingCol] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSmartPlanning, setIsSmartPlanning] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [newSong, setNewSong] = useState<Partial<Song>>({ title: '', artist: '', vocalist: '' });
  const [isLibraryExpanded, setIsLibraryExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Load from LocalStorage on mount
  useLayoutEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setData({
          ...initialData,
          ...parsed,
          config: { ...initialData.config, ...parsed.config }
        });
      } catch (e) {
        console.error("Failed to load storage", e);
      }
    }
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Save to LocalStorage on changes
  useEffect(() => {
    if (isReady) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setLastSaved(Date.now());
    }
  }, [data, isReady]);

  const handleDataLoaded = (newSongs: Song[]) => {
    setData(prev => {
      const newSongMap = { ...prev.songs };
      const newPoolIds = [...prev.columns.pool.songIds];
      newSongs.forEach(song => {
        if (!newSongMap[song.id]) {
          newSongMap[song.id] = song;
          newPoolIds.push(song.id);
        }
      });
      return { ...prev, songs: newSongMap, columns: { ...prev.columns, pool: { ...prev.columns.pool, songIds: newPoolIds } } };
    });
  };

  const handleUpdateSong = (songId: string, updates: Partial<Song>) => {
    setData(prev => ({
      ...prev,
      songs: {
        ...prev.songs,
        [songId]: { ...prev.songs[songId], ...updates }
      }
    }));
  };

  const handleUpdateTargetDuration = (columnId: string, duration: number) => {
    setData(prev => ({
      ...prev,
      columns: {
        ...prev.columns,
        [columnId]: { ...prev.columns[columnId], targetDuration: duration }
      }
    }));
  };

  const saveSnapshot = () => {
    const name = prompt("Enter a name for this setlist configuration:", `Setlist ${new Date().toLocaleDateString()}`);
    if (!name) return;

    const newSnapshot: SetlistSnapshot = {
      id: `snap-${Date.now()}`,
      name,
      timestamp: Date.now(),
      columns: JSON.parse(JSON.stringify(data.columns)),
      columnOrder: [...data.columnOrder]
    };

    setData(prev => ({
      ...prev,
      history: [newSnapshot, ...prev.history].slice(0, 20) // Keep last 20
    }));
    alert("Configuration saved to history.");
  };

  const loadSnapshot = (snapshot: SetlistSnapshot) => {
    if (!confirm(`Are you sure you want to load "${snapshot.name}"? This will overwrite your current set arrangement (library songs will remain).`)) return;
    
    setData(prev => ({
      ...prev,
      columns: JSON.parse(JSON.stringify(snapshot.columns)),
      columnOrder: [...snapshot.columnOrder]
    }));
    setIsHistoryOpen(false);
  };

  const deleteSnapshot = (id: string) => {
    if (!confirm("Delete this snapshot?")) return;
    setData(prev => ({
      ...prev,
      history: prev.history.filter(s => s.id !== id)
    }));
  };

  const handleSmartPlan = async () => {
    if (isSmartPlanning) return;
    setIsSmartPlanning(true);
    
    const setlistIds = data.columnOrder.filter(id => id.startsWith('setlist'));
    const libraryIds = data.columns.pool.songIds;
    const library = libraryIds.map(id => data.songs[id]).filter((s): s is Song => !!s);
    
    if (library.length === 0) {
      alert("Please add songs to your library first.");
      setIsSmartPlanning(false);
      return;
    }

    const setDurations: Record<string, number> = {};
    setlistIds.forEach(id => {
        if (data.columns[id].targetDuration) {
            setDurations[id] = data.columns[id].targetDuration!;
        }
    });

    try {
      const plan = await smartDistributeSongs(library, setlistIds, { ...data.config, setDurations });
      
      setData(prev => {
        const newColumns = { ...prev.columns };
        let allAssignedIds: string[] = [];
        
        Object.entries(plan).forEach(([colId, songIds]) => {
          if (newColumns[colId]) {
            newColumns[colId] = { ...newColumns[colId], songIds };
            allAssignedIds = [...allAssignedIds, ...songIds];
          }
        });

        const remainingPoolIds = prev.columns.pool.songIds.filter(id => !allAssignedIds.includes(id));
        newColumns.pool = { ...newColumns.pool, songIds: remainingPoolIds };

        return { ...prev, columns: newColumns };
      });
    } catch (e) {
      console.error("Smart Planning Error:", e);
      alert("Failed to generate plan. Please try again.");
    } finally {
      setIsSmartPlanning(false);
    }
  };

  const handleMagicScan = async () => {
    if (!newSong.title) return;
    setIsScanning(true);
    try {
      const details = await getSongDetails(newSong.title);
      setNewSong(prev => ({ ...prev, ...details }));
    } catch (error) { console.error(error); } finally { setIsScanning(false); }
  };

  const getFilteredLibrarySongs = () => {
    if (!searchQuery.trim()) return data.columns.pool.songIds;
    const query = searchQuery.toLowerCase();
    return data.columns.pool.songIds.filter(id => {
      const song = data.songs[id];
      return song && (
        song.title.toLowerCase().includes(query) ||
        song.artist.toLowerCase().includes(query) ||
        (song.vocalist && song.vocalist.toLowerCase().includes(query))
      );
    });
  };

  const updateSetlistCount = (count: number) => {
    setData(prev => {
      const keys = ['setlistA', 'setlistB', 'setlistC', 'setlistD', 'setlistE'];
      const currentActive = prev.columnOrder.filter(id => id.startsWith('setlist'));
      if (count === currentActive.length) return prev;
      let newOrder = prev.columnOrder.filter(id => !id.startsWith('setlist'));
      newOrder.push(...keys.slice(0, count));
      return { ...prev, columnOrder: newOrder };
    });
  };

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    
    const start = data.columns[source.droppableId];
    const finish = data.columns[destination.droppableId];

    if (start === finish) {
      const newIds = Array.from(start.songIds);
      newIds.splice(source.index, 1);
      newIds.splice(destination.index, 0, draggableId);
      setData(prev => ({ ...prev, columns: { ...prev.columns, [start.id]: { ...start, songIds: newIds } } }));
    } else {
      const startIds = Array.from(start.songIds);
      startIds.splice(source.index, 1);
      const finishIds = Array.from(finish.songIds);
      finishIds.splice(destination.index, 0, draggableId);
      setData(prev => ({ ...prev, columns: { 
        ...prev.columns, 
        [start.id]: { ...start, songIds: startIds },
        [finish.id]: { ...finish, songIds: finishIds }
      }}));
    }
  };

  const handleOptimize = useCallback(async (columnId: string) => {
    setOptimizingCol(columnId);
    const col = data.columns[columnId];
    const songs = col.songIds.map(id => data.songs[id]).filter((s): s is Song => !!s);
    try {
      const ids = await optimizeSetlistFlow(songs);
      setData(prev => ({ ...prev, columns: { ...prev.columns, [columnId]: { ...prev.columns[columnId], songIds: ids } } }));
    } catch (e) {
      console.error(e);
    } finally { setOptimizingCol(null); }
  }, [data]);

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(20); doc.text("Set List Generator Export", 14, 20);
    let y = 35;
    data.columnOrder.forEach(id => {
      const col = data.columns[id];
      if (col.songIds.length > 0) {
        doc.setFontSize(14); doc.text(`${col.title} (${col.targetDuration || '?' }m target)`, 14, y);
        y += 5;
        const body = col.songIds.map((sid, i) => {
          const s = data.songs[sid];
          return s ? [i+1, s.title, s.artist, s.bpm || '-', s.vocalist || '-', s.year || '-'] : [];
        });
        autoTable(doc, { startY: y, head: [['#', 'Song', 'Artist', 'BPM', 'Vocalist', 'Year']], body });
        // @ts-ignore
        y = doc.lastAutoTable.finalY + 15;
      }
    });
    doc.save(`Setlist-${Date.now()}.pdf`);
  };

  if (!isReady) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Initializing...</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-2 sm:p-6 flex flex-col overflow-hidden h-screen max-h-screen">
      <header className="mb-3 flex items-center justify-between border-b border-gray-800 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 sm:p-2 bg-indigo-600 rounded-xl shadow-lg relative">
             <Disc3 className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin-slow" />
             {lastSaved && (
               <div className="absolute -top-1 -right-1 bg-green-500 rounded-full p-0.5 border-2 border-gray-950" title="All changes saved">
                 <CheckCircle2 className="w-2 h-2 text-white" />
               </div>
             )}
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">Set List Generator</h1>
            <p className="text-gray-400 text-[8px] sm:text-[9px] uppercase font-bold tracking-widest leading-none">Intelligent Live Planning</p>
          </div>
        </div>
        <button 
          onClick={() => setIsLibraryExpanded(!isLibraryExpanded)}
          className="lg:hidden p-1.5 text-indigo-400 bg-gray-900 border border-gray-800 rounded-lg"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Smart Planner Toolbar - Comprehensive command row */}
      {Object.keys(data.songs).length > 0 && (
        <div className="mb-3 bg-gray-900/80 p-1.5 rounded-xl border border-indigo-500/20 shadow-lg flex items-center gap-3 flex-shrink-0 overflow-x-auto no-scrollbar whitespace-nowrap">
          <div className="flex items-center gap-2 pr-3 border-r border-gray-800 flex-shrink-0">
            <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
            <h3 className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Smart Planner</h3>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex gap-1.5">
              <label className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 transition-colors border border-gray-700">
                <Music2 className="w-3 h-3 text-indigo-400" />
                <span className="text-[9px] font-bold text-gray-300">TEMPOS</span>
                <input type="checkbox" checked={data.config.mixTempos} onChange={e => setData(prev => ({ ...prev, config: { ...prev.config, mixTempos: e.target.checked } }))} className="w-3 h-3 rounded text-indigo-600 bg-gray-900 border-gray-700" />
              </label>
              <label className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 transition-colors border border-gray-700">
                <Users2 className="w-3 h-3 text-indigo-400" />
                <span className="text-[9px] font-bold text-gray-300">SINGERS</span>
                <input type="checkbox" checked={data.config.separateSingers} onChange={e => setData(prev => ({ ...prev, config: { ...prev.config, separateSingers: e.target.checked } }))} className="w-3 h-3 rounded text-indigo-600 bg-gray-900 border-gray-700" />
              </label>
            </div>

            <div className="flex p-0.5 bg-gray-800 rounded-lg border border-gray-700">
              {['old', 'new', 'mixed'].map((e) => (
                <button 
                  key={e}
                  onClick={() => setData(prev => ({ ...prev, config: { ...prev.config, era: e as EraPreference } }))}
                  className={`px-3 py-1 text-[8px] font-black uppercase rounded transition-all ${data.config.era === e ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons moved here - Injected between Era and Generate */}
          <div className="flex items-center gap-1.5 border-l border-r border-gray-800 px-3">
            <div className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2 py-1 border border-gray-700">
              <Layers className="w-3 h-3 text-indigo-400" />
              <select value={data.columnOrder.filter(id => id.startsWith('setlist')).length} onChange={(e) => updateSetlistCount(Number(e.target.value))}
                className="bg-transparent text-white text-[10px] font-bold rounded focus:outline-none">
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} SETS</option>)}
              </select>
            </div>
            
            <button onClick={saveSnapshot} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-indigo-400 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border border-gray-700 uppercase">
              <Save className="w-3 h-3" /> Save
            </button>

            <button onClick={() => setIsHistoryOpen(true)} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-amber-400 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border border-gray-700 uppercase">
              <History className="w-3 h-3" /> History
            </button>

            <button onClick={handleExportPDF} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-red-400 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border border-gray-700 uppercase">
              <FileText className="w-3 h-3" /> PDF
            </button>

            <button onClick={() => { if(confirm("Reset all data? This cannot be undone.")) setData(initialData); }} className="flex items-center gap-1.5 bg-gray-800 hover:bg-red-900/30 text-gray-400 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border border-gray-700 uppercase">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>

          <button 
            onClick={handleSmartPlan}
            disabled={isSmartPlanning}
            className="px-4 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-black text-[9px] uppercase shadow-lg shadow-indigo-500/10 flex items-center justify-center gap-1.5 disabled:opacity-50 flex-shrink-0"
          >
            {isSmartPlanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Generate Sets
          </button>
        </div>
      )}

      {/* Single DragDropContext wrapping the entire board */}
      <DragDropContext onDragEnd={onDragEnd}>
        {Object.keys(data.songs).length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto">
               <FileUpload onDataLoaded={handleDataLoaded} />
          </div>
        ) : (
          <PanelGroup direction="horizontal" className="flex-1 overflow-hidden h-full">
            {/* Library Sidebar - Collapsible on Mobile */}
            <Panel defaultSize={25} minSize={15} maxSize={40} className={`
              ${isLibraryExpanded ? 'flex' : 'hidden'} lg:flex
              flex-col gap-4 overflow-hidden
              fixed inset-0 z-50 bg-gray-950 p-4 lg:p-0 lg:static lg:bg-transparent
            `}>
              <div className="flex items-center justify-between lg:hidden mb-2">
                 <h2 className="text-sm font-black uppercase tracking-widest text-indigo-400">Song Library</h2>
                 <button onClick={() => setIsLibraryExpanded(false)} className="p-2 bg-gray-800 rounded-lg"><X className="w-5 h-5" /></button>
              </div>
              <input
                type="text"
                placeholder="Search songs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
              <PanelGroup direction="vertical" className="flex-1 overflow-hidden min-h-0">
                <Panel defaultSize={60} minSize={20} maxSize={80} className="overflow-hidden">
                  <SetlistColumn
                    column={data.columns['pool']}
                    songs={getFilteredLibrarySongs().map(id => data.songs[id]).filter((s): s is Song => !!s)}
                    onOptimize={handleOptimize}
                    isOptimizing={optimizingCol === 'pool'}
                    onAddSong={() => setIsAddModalOpen(true)}
                    onUpdateSong={handleUpdateSong}
                    className="h-full"
                  />
                </Panel>
                <PanelResizeHandle className="h-1 bg-gray-800 hover:bg-indigo-500 transition-colors" />
                <Panel defaultSize={40} minSize={15} maxSize={80} className="overflow-hidden">
                  <SetlistColumn
                    column={data.columns['excluded']}
                    songs={data.columns['excluded'].songIds.map(id => data.songs[id]).filter((s): s is Song => !!s)}
                    onOptimize={handleOptimize}
                    isOptimizing={false}
                    onUpdateSong={handleUpdateSong}
                    className="h-full"
                  />
                </Panel>
              </PanelGroup>
            </Panel>

            <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-indigo-500 transition-colors hidden lg:block" />

            {/* Setlists Main Row - Horizontal Scrollable */}
            <Panel defaultSize={75} minSize={60} className="overflow-x-auto pb-4 sm:pb-6 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
              <div className="flex gap-4 sm:gap-6 h-full items-start">
                  {data.columnOrder.filter(id => id.startsWith('setlist')).map(colId => {
                      const col = data.columns[colId];
                      return (
                          <SetlistColumn 
                              key={colId} 
                              column={col} 
                              songs={col.songIds.map(id => data.songs[id]).filter((s): s is Song => !!s)} 
                              onOptimize={handleOptimize} 
                              isOptimizing={optimizingCol === colId} 
                              onUpdateTargetDuration={handleUpdateTargetDuration}
                              onUpdateSong={handleUpdateSong}
                              className="w-[280px] sm:w-80 flex-shrink-0 h-full max-h-full"
                          />
                      );
                  })}
              </div>
            </Panel>
          </PanelGroup>
        )}
      </DragDropContext>

      {/* Manual Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-gray-800 flex items-center justify-between bg-gray-800/20">
              <h2 className="text-xs sm:text-sm font-black text-white flex items-center gap-2 uppercase tracking-tighter"><Plus className="w-4 h-4 text-indigo-500" /> New Song</h2>
              <button onClick={() => { setIsAddModalOpen(false); setNewSong({ title: '', artist: '', vocalist: '' }); }} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleDataLoaded([{ ...newSong, id: `manual-${Date.now()}`, rating: 0, isExcludedFromAuto: false } as Song]);
              setNewSong({ title: '', artist: '', vocalist: '' });
              setIsAddModalOpen(false);
            }} className="p-5 sm:p-6 space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[8px] sm:text-[9px] font-black text-gray-500 uppercase mb-1 block">Title</label>
                  <input required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" value={newSong.title} onChange={e => setNewSong({...newSong, title: e.target.value})} />
                </div>
                <button type="button" onClick={handleMagicScan} className="mt-4 sm:mt-5 px-3 bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/20">{isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[8px] sm:text-[9px] font-black text-gray-500 uppercase mb-1 block">Artist</label>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" value={newSong.artist} onChange={e => setNewSong({...newSong, artist: e.target.value})} />
                </div>
                <div>
                  <label className="text-[8px] sm:text-[9px] font-black text-gray-500 uppercase mb-1 block">Year</label>
                  <input type="number" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" value={newSong.year || ''} onChange={e => setNewSong({...newSong, year: parseInt(e.target.value)})} />
                </div>
                <div className="col-span-2">
                  <label className="text-[8px] sm:text-[9px] font-black text-gray-500 uppercase mb-1 block">Vocalist</label>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" value={newSong.vocalist || ''} onChange={e => setNewSong({...newSong, vocalist: e.target.value})} />
                </div>
              </div>
              <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-[9px] sm:text-[10px] uppercase shadow-lg shadow-indigo-600/20 mt-4">Add to Library</button>
            </form>
          </div>
        </div>
      )}

      {/* History Modal */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
            <div className="p-4 sm:p-5 border-b border-gray-800 flex items-center justify-between bg-gray-800/20">
              <h2 className="text-xs sm:text-sm font-black text-white flex items-center gap-2 uppercase tracking-tighter"><History className="w-4 h-4 text-amber-500" /> Saved Configurations</h2>
              <button onClick={() => setIsHistoryOpen(false)} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {data.history.length === 0 ? (
                <div className="text-center py-12">
                   <p className="text-gray-500 text-sm">No saved configurations yet.</p>
                   <p className="text-gray-600 text-[10px] mt-1">Use the "Save Configuration" button to snapshot your current sets.</p>
                </div>
              ) : (
                data.history.map(snap => (
                  <div key={snap.id} className="bg-gray-800 border border-gray-700 p-3 sm:p-4 rounded-xl flex items-center justify-between group hover:border-indigo-500/50 transition-colors">
                    <div className="min-w-0 pr-2">
                      <h4 className="font-bold text-white text-xs sm:text-sm truncate">{snap.name}</h4>
                      <p className="text-[9px] sm:text-[10px] text-gray-500 mt-0.5">{new Date(snap.timestamp).toLocaleString()}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {snap.columnOrder.filter(id => id.startsWith('setlist')).map(cid => (
                          <div key={cid} className="px-1 py-0.5 bg-gray-900 rounded text-[7px] sm:text-[8px] font-mono text-gray-400">
                             {snap.columns[cid].songIds.length} songs
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                       <button onClick={() => loadSnapshot(snap)} className="px-2 sm:px-4 py-1.5 sm:py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[8px] sm:text-[10px] font-black uppercase rounded-lg shadow-lg shadow-indigo-600/20 transition-all">
                         Load
                       </button>
                       <button onClick={() => deleteSnapshot(snap.id)} className="p-1.5 sm:p-2 text-gray-500 hover:text-red-500 transition-colors">
                         <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                       </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
