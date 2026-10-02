
import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Song } from '../types';
import { Clock, Activity, Mic2, Calendar, Star, Wand2, Ban, GripVertical, MoreVertical, Music, AlignLeft, Trash2 } from 'lucide-react';
import { formatKey } from '../lib/keys';

interface SongCardProps {
  song: Song;
  index: number;
  onUpdateSong?: (songId: string, updates: Partial<Song>) => void;
  /** Opens the song sheet (lyrics, details, move, share). */
  onOpenSong?: (songId: string) => void;
  /** Deletes the song everywhere (asks for confirmation first). */
  onDeleteSong?: (songId: string) => void;
  /** Phone layout: bigger tap targets and a dedicated drag handle so the list can still scroll. */
  mobile?: boolean;
}

const SongCard: React.FC<SongCardProps> = ({ song, index, onUpdateSong, onOpenSong, onDeleteSong, mobile }) => {
  const handleRating = (r: number) => {
    onUpdateSong?.(song.id, { rating: song.rating === r ? 0 : r });
  };

  const toggleExclusion = () => {
    onUpdateSong?.(song.id, { isExcludedFromAuto: !song.isExcludedFromAuto });
  };

  const key = formatKey(song.key);
  const icon = mobile ? 'w-4 h-4' : 'w-3 h-3 sm:w-3.5 sm:h-3.5';
  const badge = mobile ? 'text-[11px] px-1.5 py-0.5' : 'text-[7px] px-1 py-0.5';
  const badgeIcon = mobile ? 'w-3 h-3' : 'w-2 h-2';

  return (
    <Draggable draggableId={song.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...(mobile ? {} : provided.dragHandleProps)}
          className={`
            mb-1.5 ${mobile ? 'p-2.5' : 'p-2'} rounded-lg border border-gray-700 select-none transition-all group
            ${snapshot.isDragging ? 'bg-indigo-900/90 shadow-2xl border-indigo-500 ring-2 ring-indigo-500/50 z-50' : 'bg-gray-800 hover:bg-gray-750'}
            ${song.isExcludedFromAuto ? 'opacity-75 grayscale-[0.5]' : ''}
          `}
          style={{
            ...provided.draggableProps.style,
            // On phones only the grip is a drag handle, so the rest of the card scrolls normally.
            ...(mobile ? {} : { touchAction: 'none' }),
          }}
        >
          <div className="flex items-start gap-2">
            {mobile && (
              <div
                {...provided.dragHandleProps}
                aria-label="Hold and drag to reorder"
                className="self-stretch flex items-center -ml-1 pr-0.5 text-gray-500 active:text-indigo-400"
                style={{ touchAction: 'none' }}
              >
                <GripVertical className="w-5 h-5" />
              </div>
            )}

            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpenSong?.(song.id)}
              onKeyDown={e => { if (e.key === 'Enter') onOpenSong?.(song.id); }}
              className="flex-1 min-w-0 cursor-pointer"
            >
              <h4 className={`${mobile ? 'text-sm' : 'text-xs'} font-semibold text-white truncate leading-tight flex items-center gap-1.5`}>
                <span className="truncate">{song.title}</span>
                {song.lyrics && <AlignLeft className={`${mobile ? 'w-3.5 h-3.5' : 'w-3 h-3'} text-indigo-400 flex-shrink-0`} aria-label="Has lyrics" />}
              </h4>
              <p className={`${mobile ? 'text-xs' : 'text-[9px]'} text-gray-400 truncate mt-0.5`}>{song.artist}</p>
            </div>

            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); toggleExclusion(); }}
                className={`${mobile ? 'p-2' : 'p-1'} rounded transition-colors ${song.isExcludedFromAuto ? 'text-red-500 bg-red-500/10' : 'text-gray-500 hover:text-indigo-400'}`}
                title={song.isExcludedFromAuto ? "Excluded from AI Generation" : "Include in AI Generation"}
              >
                {song.isExcludedFromAuto ? <Ban className={icon} /> : <Wand2 className={icon} />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onOpenSong?.(song.id); }}
                className={`${mobile ? 'p-2' : 'p-1'} rounded text-gray-500 hover:text-white transition-colors`}
                title="Lyrics, details, move"
                aria-label="Song options"
              >
                <MoreVertical className={icon} />
              </button>
              {onDeleteSong && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteSong(song.id); }}
                  className={`${mobile ? 'p-2' : 'p-1'} rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors`}
                  title="Delete song"
                  aria-label="Delete song"
                >
                  <Trash2 className={icon} />
                </button>
              )}
            </div>
          </div>

          {/* Rating and info footer */}
          <div className={`${mobile ? 'mt-1.5 pl-5' : 'mt-1.5'} flex items-center justify-between gap-1`}>
            <div className="flex items-center gap-0">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={(e) => { e.stopPropagation(); handleRating(star); }}
                  className={`transition-colors ${mobile ? 'p-1' : 'p-0.5 -m-0.5'} ${star <= (song.rating || 0) ? 'text-amber-400' : 'text-gray-600 hover:text-gray-400'}`}
                  aria-label={`${star} star`}
                >
                  <Star className={`${mobile ? 'w-4 h-4' : 'w-2.5 h-2.5'} ${star <= (song.rating || 0) ? 'fill-current' : ''}`} />
                </button>
              ))}
            </div>

            <div className="flex items-center flex-wrap justify-end gap-x-1.5 gap-y-1">
              {key && (
                <div className={`flex items-center gap-0.5 bg-gray-900/50 rounded font-mono font-bold text-fuchsia-300 ${badge}`} title="Key">
                  <Music className={badgeIcon} />
                  {key}
                </div>
              )}
              {song.bpm && (
                <div className={`flex items-center gap-0.5 bg-gray-900/50 rounded text-gray-400 font-mono ${badge}`}>
                  <Activity className={badgeIcon} />
                  {song.bpm}
                </div>
              )}
              {song.duration && (
                <div className={`flex items-center gap-0.5 bg-gray-900/50 rounded text-emerald-400/80 font-mono ${badge}`}>
                  <Clock className={badgeIcon} />
                  {song.duration}
                </div>
              )}
              {song.vocalist && (
                <div className={`flex items-center gap-0.5 text-indigo-300/80 ${mobile ? 'text-[11px]' : 'text-[7px] sm:text-[8px]'}`}>
                  <Mic2 className={badgeIcon} />
                  <span className="truncate max-w-[56px] sm:max-w-[60px]">{song.vocalist}</span>
                </div>
              )}
              {song.year && (
                <div className={`flex items-center gap-0.5 text-amber-400/80 ${mobile ? 'text-[11px]' : 'text-[7px] sm:text-[8px]'}`}>
                  <Calendar className={badgeIcon} />
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
