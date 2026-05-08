
import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Song } from '../types';
import { Music, Clock, Activity, Mic2, Calendar, Star, Wand2, Ban } from 'lucide-react';

interface SongCardProps {
  song: Song;
  index: number;
  onUpdateSong?: (songId: string, updates: Partial<Song>) => void;
}

const SongCard: React.FC<SongCardProps> = ({ song, index, onUpdateSong }) => {
  const handleRating = (r: number) => {
    onUpdateSong?.(song.id, { rating: song.rating === r ? 0 : r });
  };

  const toggleExclusion = () => {
    onUpdateSong?.(song.id, { isExcludedFromAuto: !song.isExcludedFromAuto });
  };

  return (
    <Draggable draggableId={song.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`
            mb-1.5 p-2 rounded-lg border border-gray-700 select-none transition-all group
            ${snapshot.isDragging ? 'bg-indigo-900/90 shadow-2xl border-indigo-500 ring-2 ring-indigo-500/50 z-50' : 'bg-gray-800 hover:bg-gray-750'}
            ${song.isExcludedFromAuto ? 'opacity-75 grayscale-[0.5]' : ''}
            touch-none
          `}
          style={{
            ...provided.draggableProps.style,
            touchAction: 'none' // Important for mobile DnD
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-white truncate leading-tight">{song.title}</h4>
              <p className="text-[9px] text-gray-400 truncate mt-0.5">{song.artist}</p>
            </div>
            
            <div className="flex flex-col items-end gap-0.5">
              {song.bpm && (
                <div className="flex items-center gap-0.5 bg-gray-900/50 px-1 py-0.5 rounded text-[7px] text-gray-400 font-mono">
                  <Activity className="w-2 h-2" />
                  {song.bpm}
                </div>
              )}
              <button 
                onClick={(e) => { e.stopPropagation(); toggleExclusion(); }}
                className={`p-1 rounded transition-colors ${song.isExcludedFromAuto ? 'text-red-500 bg-red-500/10' : 'text-gray-500 hover:text-indigo-400 lg:opacity-0 group-hover:opacity-100'}`}
                title={song.isExcludedFromAuto ? "Excluded from AI Generation" : "Include in AI Generation"}
              >
                {song.isExcludedFromAuto ? <Ban className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <Wand2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
              </button>
            </div>
          </div>

          {/* Rating and Info Footer */}
          <div className="mt-1.5 flex items-center justify-between gap-1">
            <div className="flex items-center gap-0">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={(e) => { e.stopPropagation(); handleRating(star); }}
                  className={`transition-colors p-0.5 -m-0.5 ${star <= (song.rating || 0) ? 'text-amber-400' : 'text-gray-600 hover:text-gray-400'}`}
                >
                  <Star className={`w-2.5 h-2.5 ${star <= (song.rating || 0) ? 'fill-current' : ''}`} />
                </button>
              ))}
            </div>

            <div className="flex items-center flex-wrap justify-end gap-x-1.5 gap-y-0.5 text-[7px] sm:text-[8px] text-gray-500">
              {song.vocalist && (
                <div className="flex items-center gap-0.5 text-indigo-300/80">
                  <Mic2 className="w-2.5 h-2.5" />
                  <span className="truncate max-w-[40px] sm:max-w-[60px]">{song.vocalist}</span>
                </div>
              )}
              {song.year && (
                <div className="flex items-center gap-0.5 text-amber-400/80">
                  <Calendar className="w-2.5 h-2.5" />
                  <span>{song.year}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
};

export default SongCard;
