
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
}

export type EraPreference = 'old' | 'new' | 'mixed';

export interface GeneratorConfig {
  mixTempos: boolean;
  separateSingers: boolean;
  era: EraPreference;
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

export interface BoardData {
  songs: Record<string, Song>;
  columns: Record<string, SetlistColumn>;
  columnOrder: string[];
  history: SetlistSnapshot[];
  config: GeneratorConfig;
}

export interface FileUploadProps {
  onDataLoaded: (songs: Song[]) => void;
}
