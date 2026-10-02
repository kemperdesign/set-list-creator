
import React, { useRef, useState } from 'react';
import { Song } from '../types';
import { Upload, AlertCircle, Wand2, Download, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { generateSampleData } from '../services/geminiService';
import { buildTemplateCsv, downloadTextFile, parseSongsCsv, parseSongsJson, ImportResult } from '../lib/csv';
import { titleKey } from '../lib/boardData';

interface FileUploadProps {
  onDataLoaded: (songs: Song[]) => void;
  /** Titles already in the library (via titleKey) so the preview can say what will be skipped. */
  existingTitles?: Set<string>;
  /** Hide the "generate sample library" button (used when adding to an existing library). */
  hideSample?: boolean;
  onDone?: () => void;
}

export const downloadTemplate = () =>
  downloadTextFile('setlist-import-template.csv', buildTemplateCsv());

const FileUpload: React.FC<FileUploadProps> = ({ onDataLoaded, existingTitles, hideSample, onDone }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preview, setPreview] = useState<{ fileName: string; result: ImportResult; fresh: Song[]; dupes: number } | null>(null);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setPreview(null);

    if (/\.xlsx?$/i.test(file.name)) {
      setError('Excel files can\'t be read directly. In Excel choose File > Save As > "CSV (Comma delimited)", then upload that file.');
      return;
    }

    try {
      const text = await file.text();
      const result = file.name.toLowerCase().endsWith('.json') ? parseSongsJson(text) : parseSongsCsv(text);
      if (result.error) { setError(result.error); return; }
      if (result.songs.length === 0) {
        setError('No valid songs found. Download the template to see the expected format.');
        return;
      }
      const have = existingTitles || new Set<string>();
      const fresh = result.songs.filter(s => !have.has(titleKey(s.title)));
      setPreview({ fileName: file.name, result, fresh, dupes: result.songs.length - fresh.length });
    } catch {
      setError('Failed to read that file. Please upload a valid CSV or JSON.');
    }
  };

  const confirmImport = () => {
    if (!preview) return;
    onDataLoaded(preview.fresh);
    setPreview(null);
    onDone?.();
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const songs = await generateSampleData();
      if (songs.length === 0) { setError('Could not generate a sample library right now.'); return; }
      onDataLoaded(songs);
      onDone?.();
    } catch {
      setError('Failed to generate sample data.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto p-4 sm:p-6 bg-gray-800 rounded-xl border border-gray-700 shadow-xl">
      <div className="text-center mb-5">
        <h2 className="text-lg sm:text-xl font-bold text-white mb-1">Import Your Songs</h2>
        <p className="text-gray-400 text-sm">Upload a CSV or JSON file with your song list. Keys, durations and lyrics are supported.</p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={downloadTemplate}
          className="w-full py-3 bg-gray-900 hover:bg-gray-700 border border-gray-600 text-gray-100 rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
        >
          <Download className="w-4 h-4 text-emerald-400" /> Download CSV Template
        </button>

        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-600 hover:border-indigo-500 hover:bg-gray-700/50 transition-all rounded-lg p-6 cursor-pointer flex flex-col items-center justify-center group"
        >
          <Upload className="w-9 h-9 text-gray-400 group-hover:text-indigo-400 transition-colors mb-2" />
          <span className="text-gray-300 font-medium group-hover:text-white text-center">Tap to choose your filled-in CSV or JSON</span>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json,text/plain"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {!hideSample && (
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {isGenerating ? <span className="animate-pulse">Generative Magic...</span> : <><Wand2 className="w-4 h-4" /> Generate Sample Library</>}
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-4 p-3 bg-gray-900 border border-emerald-700/50 rounded-lg space-y-3">
          <div className="flex items-start gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-gray-200 min-w-0">
              <p className="font-semibold truncate">{preview.fileName}</p>
              <p className="text-gray-400 text-xs mt-0.5">
                {preview.fresh.length} new song{preview.fresh.length === 1 ? '' : 's'} ready
                {preview.dupes > 0 && ` · ${preview.dupes} already in your library (skipped)`}
                {preview.result.skipped.length > 0 && ` · ${preview.result.skipped.length} row${preview.result.skipped.length === 1 ? '' : 's'} skipped`}
              </p>
            </div>
          </div>

          {preview.fresh.length > 0 && (
            <ul className="text-xs text-gray-400 max-h-32 overflow-y-auto space-y-0.5 pl-6 list-disc">
              {preview.fresh.slice(0, 8).map(s => (
                <li key={s.id} className="truncate">
                  <span className="text-gray-200">{s.title}</span> – {s.artist}{s.key ? ` · ${s.key}` : ''}{s.duration ? ` · ${s.duration}` : ''}
                </li>
              ))}
              {preview.fresh.length > 8 && <li className="list-none text-gray-500">…and {preview.fresh.length - 8} more</li>}
            </ul>
          )}

          {preview.result.skipped.length > 0 && (
            <p className="text-[11px] text-amber-400/90">
              Skipped: {preview.result.skipped.slice(0, 3).map(s => `row ${s.row} (${s.reason})`).join(', ')}
              {preview.result.skipped.length > 3 ? '…' : ''}
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={() => setPreview(null)} className="flex-1 py-2.5 text-xs font-bold uppercase text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg">
              Cancel
            </button>
            <button
              onClick={confirmImport}
              disabled={preview.fresh.length === 0}
              className="flex-[2] py-2.5 text-xs font-bold uppercase text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Import {preview.fresh.length} song{preview.fresh.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-900/50 border border-red-700 text-red-200 rounded-lg flex items-start gap-2 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
