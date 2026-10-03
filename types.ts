
export interface Song {
  id: string;
  title: string;
  artist: string;
  key?: string;
  bpm?: number;
  duration?: string;
  energy?: 'Low' | 'Medium' | 'High';
  vocalist?: string;
  year?: number;
  rating?: number; // 0 to 5
  isExcludedFromAuto?: boolean; // If true, Gemini skips this song
  /** Lyrics / chord chart text. Entered by the band (never fetched automatically). */
  lyrics?: string;
}

export type EraPreference = 'old' | 'new' | 'mixed';

export interface GeneratorConfig {
  mixTempos: boolean;
  separateSingers: boolean;
  era: EraPreference;
  /** Keep songs in the same key together inside a set to reduce instrument changes. */
  groupKeys?: boolean;
  setDurations?: Record<string, number>; // Map of setlistId to target duration in minutes
}

export interface SetlistColumn {
  id: string;
  title: string;
  songIds: string[];
  color: string;
  className?: string;
  targetDuration?: number; // Target duration in minutes
}

export interface SetlistSnapshot {
  id: string;
  name: string;
  timestamp: number;
  columns: Record<string, SetlistColumn>;
  columnOrder: string[];
}

/** A named copy of the whole song library (with keys and lyrics) that can be updated, reloaded or exported. */
export interface SongListSnapshot {
  id: string;
  name: string;
  timestamp: number;
  songs: Song[];
}

export interface BoardData {
  songs: Record<string, Song>;
  columns: Record<string, SetlistColumn>;
  columnOrder: string[];
  history: SetlistSnapshot[];
  /** Saved song lists (song library snapshots). */
  songLists?: SongListSnapshot[];
  config: GeneratorConfig;
}

/** A band = one named song library + its sets, stored as one row in the `setlists` table. */
export interface BandSummary {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  data: BoardData;
}

export interface FileUploadProps {
  onDataLoaded: (songs: Song[]) => void;
}
