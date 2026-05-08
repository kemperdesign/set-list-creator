
import React, { useRef, useState } from 'react';
import { Song } from '../types';
import { Upload, AlertCircle, Wand2, FileJson } from 'lucide-react';
import { generateSampleData } from '../services/geminiService';

interface FileUploadProps {
  onDataLoaded: (songs: Song[]) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onDataLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        let parsedSongs: Song[] = [];

        if (file.name.endsWith('.json')) {
          parsedSongs = parseJSON(text);
        } else {
          parsedSongs = parseCSV(text);
        }

        if (parsedSongs.length === 0) {
          setError("No valid songs found. Ensure file contains song data.");
        } else {
          setError(null);
          onDataLoaded(parsedSongs);
        }
      } catch (err) {
        setError("Failed to parse file. Please upload a valid CSV or JSON.");
      }
    };
    reader.readAsText(file);
  };

  const parseJSON = (jsonText: string): Song[] => {
    const data = JSON.parse(jsonText);
    const items = Array.isArray(data) ? data : (data.songs || []);
    return items.map((item: any, index: number): Song | null => {
      const title = item.name || item.title || item.Song;
      if (!title) return null;
      return {
        id: `json-${index}-${Date.now()}`,
        title: title,
        artist: item.artist || "Unknown Artist",
        key: item.key,
        bpm: item.bpm ? parseInt(item.bpm) : undefined,
        duration: item.duration,
        vocalist: item.vocalist,
        year: item.year ? parseInt(item.year) : undefined
      };
    }).filter((s: any): s is Song => s !== null);
  };

  const parseCSV = (csvText: string): Song[] => {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return [];
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
    const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('song') || h.includes('name'));
    const artistIdx = headers.findIndex(h => h.includes('artist'));
    const yearIdx = headers.findIndex(h => h.includes('year') || h.includes('date') || h.includes('released'));
    const bpmIdx = headers.findIndex(h => h.includes('bpm'));
    const vocalistIdx = headers.findIndex(h => h.includes('vocal') || h.includes('singer'));

    if (titleIdx === -1) return [];

    return lines.slice(1).map((line, index): Song | null => {
      const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^["']|["']$/g, ''));
      if (values.length < 1) return null;
      const title = values[titleIdx];
      if (!title) return null;
      return {
        id: `csv-${index}-${Date.now()}`,
        title,
        artist: artistIdx !== -1 ? values[artistIdx] : "Unknown Artist",
        year: yearIdx !== -1 ? parseInt(values[yearIdx].replace(/[^0-9]/g, '')) || undefined : undefined,
        bpm: bpmIdx !== -1 ? parseInt(values[bpmIdx].replace(/[^0-9]/g, '')) || undefined : undefined,
        vocalist: vocalistIdx !== -1 ? values[vocalistIdx] : undefined,
      };
    }).filter((s): s is Song => s !== null);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const songs = await generateSampleData();
      onDataLoaded(songs);
    } catch (e) {
      setError("Failed to generate sample data.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto p-6 bg-gray-800 rounded-xl border border-gray-700 shadow-xl mb-8">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-white mb-2">Import Your Library</h2>
        <p className="text-gray-400 text-sm">Upload a CSV or JSON file containing your song list</p>
      </div>
      <div className="flex flex-col gap-4">
        <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-600 hover:border-indigo-500 hover:bg-gray-700/50 transition-all rounded-lg p-8 cursor-pointer flex flex-col items-center justify-center group">
          <Upload className="w-10 h-10 text-gray-400 group-hover:text-indigo-400 transition-colors mb-2" />
          <span className="text-gray-300 font-medium group-hover:text-white">Click to Upload CSV or JSON</span>
          <input type="file" accept=".csv,.json" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
        </div>
        <button onClick={handleGenerate} disabled={isGenerating} className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50">
          {isGenerating ? <span className="animate-pulse">Generative Magic...</span> : <><Wand2 className="w-4 h-4" /> Generate Sample Library</>}
        </button>
      </div>
      {error && <div className="mt-4 p-3 bg-red-900/50 border border-red-700 text-red-200 rounded-lg flex items-center gap-2 text-sm"><AlertCircle className="w-4 h-4" /> {error}</div>}
    </div>
  );
};

export default FileUpload;
