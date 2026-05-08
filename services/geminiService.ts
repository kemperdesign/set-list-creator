
import { GoogleGenAI, Type } from "@google/genai";
import { Song, GeneratorConfig } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const smartDistributeSongs = async (
  library: Song[],
  setlistIds: string[],
  config: GeneratorConfig
): Promise<Record<string, string[]>> => {
  const modelId = "gemini-3-pro-preview";
  
  // Filter out songs manually excluded by user before sending to AI
  const eligibleSongs = library.filter(s => !s.isExcludedFromAuto);

  if (eligibleSongs.length === 0) return {};

  const songData = eligibleSongs.map(s => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    bpm: s.bpm || "Unknown",
    vocalist: s.vocalist || "Unknown",
    year: s.year || "Unknown",
    duration: s.duration || "3:30",
    rating: s.rating || 0
  }));

  const eraContext = {
    old: "Prioritize songs from 1950 to 1989.",
    new: "Prioritize songs from 1990 to the present.",
    mixed: "Create an even mix of all eras available."
  }[config.era];

  const durationConstraints = config.setDurations 
    ? `TARGET DURATIONS: ${Object.entries(config.setDurations).map(([id, mins]) => `${id}: ${mins} minutes`).join(', ')}.`
    : "Distribute the songs as evenly as possible across the sets.";

  const prompt = `
    Act as an elite concert director. I have a library of ${eligibleSongs.length} eligible songs. 
    Organize these songs into ${setlistIds.length} distinct setlists (IDs: ${setlistIds.join(', ')}).
    
    CRITICAL RULES:
    1. PRIORITY: Songs with a higher "rating" (4-5 stars) MUST be prioritized and included in the setlists. Low-rated songs (1-2 stars) should only be used as filler if the set time isn't met.
    2. ${durationConstraints} Assume average song length is 3.5 minutes if not specified.
    3. ${config.mixTempos ? "MIX TEMPOS: Ensure a variation of slow and fast songs. Avoid long streaks of the same tempo." : "Tempo doesn't matter."}
    4. ${config.separateSingers ? "SEPARATE SINGERS: No vocalist should sing two songs in a row within a set." : "Vocalist order doesn't matter."}
    5. ERA PREFERENCE: ${eraContext}
    6. Return ONLY a valid JSON object where keys are the setlist IDs provided and values are arrays of song IDs. Use ONLY the exact song IDs provided in the list. Do not invent new IDs.
    
    Available Songs (with ratings): ${JSON.stringify(songData)}
  `;

  // Dynamically build the schema properties since Gemini requires non-empty properties for OBJECT type
  const properties: Record<string, any> = {};
  setlistIds.forEach(id => {
    properties[id] = {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: `List of song IDs assigned to ${id}`
    };
  });

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: properties,
          required: setlistIds
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    // Verify that the result only contains IDs that actually exist in the library
    const validIds = new Set(eligibleSongs.map(s => s.id));
    const cleanedResult: Record<string, string[]> = {};
    
    Object.entries(result).forEach(([key, val]) => {
      if (Array.isArray(val)) {
        cleanedResult[key] = val.filter(id => validIds.has(id as string)) as string[];
      }
    });

    return cleanedResult;
  } catch (error) {
    console.error("Smart distribution failed:", error);
    return {};
  }
};

export const optimizeSetlistFlow = async (songs: Song[]): Promise<string[]> => {
  if (songs.length < 2) return songs.map(s => s.id);
  const modelId = "gemini-3-pro-preview";
  const songData = songs.map(s => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    key: s.key || "Unknown",
    bpm: s.bpm || "Unknown",
    vocalist: s.vocalist,
    duration: s.duration || "3:30",
    rating: s.rating
  }));

  const prompt = `Act as a setlist curator. Reorder these songs for best flow considering tempo, key, and vocalist rotation. 
  Prioritize placing high-rated songs in climactic spots (start/end of set).
  Songs: ${JSON.stringify(songData)} 
  Return JSON { "sortedIds": [...] }`;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { sortedIds: { type: Type.ARRAY, items: { type: Type.STRING } } },
          required: ["sortedIds"]
        }
      }
    });
    const result = JSON.parse(response.text || "{}");
    return result.sortedIds || songs.map(s => s.id);
  } catch (error) {
    return songs.map(s => s.id);
  }
};

export const getSongDetails = async (title: string): Promise<Partial<Song>> => {
  const modelId = "gemini-3-flash-preview";
  const prompt = `Provide Artist, Key, BPM, and Release Year for the song "${title}". Return JSON.`;
  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            artist: { type: Type.STRING },
            key: { type: Type.STRING },
            bpm: { type: Type.NUMBER },
            year: { type: Type.NUMBER }
          },
          required: ["artist"]
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) { return {}; }
};

export const generateSampleData = async (): Promise<Song[]> => {
  const modelId = "gemini-3-flash-preview";
  const prompt = `Generate 15 popular songs (Title, Artist, Key, BPM, Duration (e.g. 3:45), Vocalist, Year (1950-2024)). Return JSON.`;
  try {
      const response = await ai.models.generateContent({
          model: modelId,
          contents: prompt,
          config: {
              responseMimeType: "application/json",
              responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                      songs: {
                          type: Type.ARRAY,
                          items: {
                              type: Type.OBJECT,
                              properties: {
                                  title: { type: Type.STRING },
                                  artist: { type: Type.STRING },
                                  key: { type: Type.STRING },
                                  bpm: { type: Type.NUMBER },
                                  duration: { type: Type.STRING },
                                  vocalist: { type: Type.STRING },
                                  year: { type: Type.NUMBER },
                                  energy: { type: Type.STRING, enum: ["Low", "Medium", "High"] }
                              },
                              required: ["title", "artist", "year"]
                          }
                      }
                  },
                  required: ["songs"]
              }
          }
      });
      const data = JSON.parse(response.text || "{}");
      return (data.songs || []).map((s: any, i: number) => ({ 
        ...s, 
        id: `gen-${i}-${Date.now()}`,
        rating: Math.floor(Math.random() * 5) + 1,
        isExcludedFromAuto: false
      }));
  } catch (e) { return []; }
}
