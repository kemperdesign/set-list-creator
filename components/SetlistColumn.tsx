
import React from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { SetlistColumn as ColumnType, Song } from '../types';
import SongCard from './SongCard';
import { Sparkles, Plus, Clock, Target } from 'lucide-react';

interface SetlistColumnProps {
  column: ColumnType;
  songs: Song[];
  isDropDisabled?: boolean;
  onOptimize: (columnId: string) => void | Promise<void>;
  isOptimizing: boolean;
  onAddSong?: () => void;
  onUpdateTargetDuration?: (columnId: string, duration: number) => void;
  onUpdateSong?: (songId: string, updates: Partial<Song>) => void;
  className?: string;
}

const SetlistColumn: React.FC<SetlistColumnProps> = ({ 
  column, 
  songs, 
  isDropDisabled, 
  onOptimize,
  isOptimizing,
  onAddSong,
  onUpdateTargetDuration,
  onUpdateSong,
  className
}) => {
  // Defensive duration calculation: handle potential undefined song objects
  const currentDuration = Math.round(songs.reduce((acc, song) => {
    if (!song) return acc;
    if (song.duration && song.duration.includes(':')) {
      const [m, s] = song.duration.split(':').map(Number);
      return acc + m + (s / 60);
    }
    return acc + 3.5; // Default estimate
  }, 0));

  const isOver = column.targetDuration && currentDuration > column.targetDuration;
  const progress = column.targetDuration ? (currentDuration / column.targetDuration) * 100 : 0;

  return (
    <div className={`flex flex-col bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden ${className || column.className || 'h-full min-h-[400px]'}`}>
      {/* Header */}
      <div className={`p-3 border-b border-gray-800 ${column.color} border-t-4 bg-gray-800/40`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-gray-100 text-sm">{column.title}</h3>
            {column.id === 'pool' && onAddSong && (
               <button 
                onClick={onAddSong}
                className="p-1 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors"
                title="Add song manually"
               >
                 <Plus className="w-3.5 h-3.5" />
               </button>
            )}
          </div>
          <span className="text-[10px] font-mono bg-gray-900 px-1.5 py-0.5 rounded text-gray-400">
            {songs.length}
          </span>
        </div>
        
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                 <div className={`text-[11px] font-medium flex items-center gap-1 ${isOver ? 'text-amber-400' : 'text-gray-400'}`}>
                    <Clock className="w-3 h-3" />
                    {currentDuration}m
                    {column.targetDuration ? <span className="opacity-50 text-[10px]">/ {column.targetDuration}m</span> : ''}
                 </div>
                 
                 {column.id !== 'pool' && column.id !== 'excluded' && onUpdateTargetDuration && (
                    <div className="flex items-center gap-1 bg-gray-950/50 border border-gray-800 rounded px-1.5 py-0.5 group focus-within:ring-1 focus-within:ring-indigo-500">
                        <Target className="w-3 h-3 text-gray-500 group-focus-within:text-indigo-400" />
                        <input 
                            type="number" 
                            placeholder="Set mins"
                            className="w-8 bg-transparent border-none text-[10px] text-indigo-300 placeholder-gray-700 focus:outline-none focus:ring-0 p-0"
                            value={column.targetDuration || ''}
                            onChange={(e) => onUpdateTargetDuration(column.id, parseInt(e.target.value) || 0)}
                        />
                        <span className="text-[9px] text-gray-600 font-bold">MINS</span>
                    </div>
                 )}
            </div>
            
            {column.targetDuration ? (
                <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-500 ${isOver ? 'bg-amber-500' : 'bg-indigo-500'}`}
                        style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                </div>
            ) : null}

             {column.id !== 'pool' && songs.length >= 2 && (
                 <button 
                    onClick={() => onOptimize(column.id)}
                    disabled={isOptimizing}
                    className="w-full mt-1 py-1 text-[10px] flex items-center justify-center gap-1 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20 rounded transition-all disabled:opacity-50"
                 >
                    <Sparkles className={`w-2.5 h-2.5 ${isOptimizing ? 'animate-spin' : ''}`} />
                    {isOptimizing ? 'Optimizing Flow...' : 'Auto-Optimize Flow'}
                 </button>
             )}
        </div>
      </div>

      {/* Droppable Area with Scrollbar */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-2">
        <Droppable droppableId={column.id} isDropDisabled={isDropDisabled}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`
                min-h-[100px] rounded-lg transition-colors p-1
                ${snapshot.isDraggingOver ? 'bg-gray-800/30 ring-2 ring-inset ring-indigo-500/10' : ''}
              `}
            >
              {songs.map((song, index) => (
                song && <SongCard key={song.id} song={song} index={index} onUpdateSong={onUpdateSong} />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    </div>
  );
};

export default SetlistColumn;
