
import { GoogleGenAI, Type } from "@google/genai";
import { Song, GeneratorConfig } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY || '' });

// Google retires Gemini model IDs regularly (gemini-1.5-*, gemini-2.0-flash and gemini-3-pro-preview
// are all shut down). If AI features start failing, check https://ai.google.dev/gemini-api/docs/deprecations
// and update these two constants.
const PRO_MODEL = "gemini-3.1-pro-preview";
const FLASH_MODEL = "gemini-3.6-flash";

// Backup provider: if Gemini fails (busy, quota, retired model, bad key) every AI call is retried on
// OpenAI. Set VITE_OPENAI_API_KEY in Vercel (and optionally VITE_OPENAI_MODEL) to turn it on.
const OPENAI_KEY = process.env.VITE_OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.VITE_OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_KEY = process.env.VITE_GEMINI_API_KEY || '';
const TRANSIENT = /503|429|overloaded|high demand|unavailable|timeout|fetch/i;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const callOpenAI = async (prompt: string, schema: any, temperature?: number): Promise<any> => {
  const shape = JSON.stringify(schema).replace(/"type":"([A-Z]+)"/g, (_m, t) => `"type":"${t.toLowerCase()}"`);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      ...(temperature !== undefined && /gpt-4/.test(OPENAI_MODEL) ? { temperature } : {}),
      messages: [
        { role: 'system', content: 'You are a precise assistant. Reply with a single JSON object only.' },
        { role: 'user', content: `${prompt}\n\nReturn JSON matching this JSON schema exactly:\n${shape}` },
      ],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    throw new Error(`OpenAI ${res.status}: ${detail || res.statusText}`);
  }
  const body = await res.json();
  return JSON.parse(body?.choices?.[0]?.message?.content || '{}');
};

/**
 * One JSON answer from the AI. Tries the given Gemini models in order (waiting briefly when Google is
 * busy), then falls back to OpenAI if a key is configured. Throws only if every provider failed.
 */
const aiJson = async (prompt: string, schema: any, models: string[], temperature?: number): Promise<any> => {
  let lastError: unknown;
  if (GEMINI_KEY) {
    for (let i = 0; i < models.length; i++) {
      try {
        const response = await ai.models.generateContent({
          model: models[i],
          contents: prompt,
          config: { responseMimeType: 'application/json', responseSchema: schema, ...(temperature !== undefined ? { temperature } : {}) },
        });
        return JSON.parse(response.text || '{}');
      } catch (e) {
        lastError = e;
        console.warn(`${models[i]} failed (attempt ${i + 1}):`, e);
        if (i < models.length - 1) {
          // Temporary overload: wait and retry. Anything else (bad key, retired model): try the next model right away.
          if (TRANSIENT.test(String((e as any)?.message || e))) await sleep(1500);
        }
      }
    }
  } else {
    lastError = new Error('No AI key is configured for this site (VITE_GEMINI_API_KEY or VITE_OPENAI_API_KEY in Vercel).');
  }
  if (OPENAI_KEY) {
    try {
      return await callOpenAI(prompt, schema, temperature);
    } catch (e) {
      console.warn('OpenAI backup failed:', e);
      throw new Error(`Gemini: ${describeAiError(lastError)} OpenAI backup: ${String((e as any)?.message || e)}`);
    }
  }
  throw lastError;
};

export const smartDistributeSongs = async (
  library: Song[],
  setlistIds: string[],
  config: GeneratorConfig
): Promise<Record<string, string[]>> => {
  // Filter out songs manually excluded by user before sending to AI
  const eligibleSongs = library.filter(s => !s.isExcludedFromAuto);

  if (eligibleSongs.length === 0) return {};

  const songData = eligibleSongs.map(s => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    key: s.key || "Unknown",
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
    6. ${config.groupKeys ? "GROUP BY KEY: The band wants to minimise instrument changes (capos, tunings, keyboard/harmonica swaps). Within each set, place songs in the same musical key back-to-back, and order the key groups so neighbouring groups are closely related keys (for example C, then Am, then G, then Em). Songs with an Unknown key can go anywhere. This rule takes priority over rules 3 and 4 when they conflict." : "Musical key doesn't matter."}
    7. Return ONLY a valid JSON object where keys are the setlist IDs provided and values are arrays of song IDs. Use ONLY the exact song IDs provided in the list. Do not invent new IDs.

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

  const schema = { type: Type.OBJECT, properties: properties, required: setlistIds };

  try {
    // Pro is best at planning but is also the one most likely to be busy or retired, so Flash is the
    // backup, then OpenAI. The app also has a built-in planner as the final fallback.
    const result = await aiJson(prompt, schema, [PRO_MODEL, FLASH_MODEL, FLASH_MODEL]);
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
    // Surface the real reason (bad key, quota, retired model...) instead of an empty plan.
    throw new Error(describeAiError(error));
  }
};

export const optimizeSetlistFlow = async (
  songs: Song[],
  options: { groupKeys?: boolean } = {}
): Promise<string[]> => {
  if (songs.length < 2) return songs.map(s => s.id);
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

  const keyRule = options.groupKeys
    ? "IMPORTANT: keep songs in the same key together and order the key groups so neighbouring groups are closely related keys, to minimise instrument changes."
    : "Consider key changes between songs.";

  const prompt = `Act as a setlist curator. Reorder these songs for best flow considering tempo, key, and vocalist rotation.
  ${keyRule}
  Prioritize placing high-rated songs in climactic spots (start/end of set).
  Songs: ${JSON.stringify(songData)}
  Return JSON { "sortedIds": [...] } using only the exact IDs given, each exactly once.`;

  try {
    const result = await aiJson(prompt, {
      type: Type.OBJECT,
      properties: { sortedIds: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ["sortedIds"]
    }, [PRO_MODEL, FLASH_MODEL]);
    const valid = new Set(songs.map(s => s.id));
    const sorted: string[] = (result.sortedIds || []).filter((id: string) => valid.has(id));
    // Never lose a song if the model skipped one.
    const missing = songs.map(s => s.id).filter(id => !sorted.includes(id));
    if (!sorted.length) throw new Error('The AI returned no order.');
    return [...sorted, ...missing];
  } catch (error) {
    // The caller falls back to the built-in ordering.
    throw error;
  }
};

/** Friendly message for the errors people actually hit (missing key, retired model, quota). */
export const describeAiError = (error: unknown): string => {
  const msg = error instanceof Error ? error.message : String(error);
  if (!GEMINI_KEY && !OPENAI_KEY) {
    return 'No AI key is configured for this site (VITE_GEMINI_API_KEY or VITE_OPENAI_API_KEY in Vercel).';
  }
  if (/API key|API_KEY|permission|403|401/i.test(msg)) return 'Google rejected the Gemini API key. Check that VITE_GEMINI_API_KEY is valid.';
  if (/404|not found|no longer available|deprecated/i.test(msg)) return 'The AI model name is out of date. It needs updating in services/geminiService.ts.';
  if (/503|high demand|overloaded|unavailable/i.test(msg)) return 'Google\'s AI is overloaded right now (this is temporary and not a problem with your app). Wait a minute and try again.';
  if (/429|quota|rate/i.test(msg)) return 'The Gemini quota was hit. Wait a minute and try again.';
  return `The AI request failed: ${msg.slice(0, 160)}`;
};

export interface SongLookup {
  id: string;
  title: string;
  artist?: string;
  key?: string;
  bpm?: number;
  duration?: string;
  year?: number;
}

export interface EnrichResult {
  updates: Record<string, Partial<Pick<Song, 'artist' | 'key' | 'bpm' | 'duration' | 'year'>>>;
  /** Songs in batches that failed. */
  failed: number;
  error?: string;
}

const BATCH_SIZE = 15;

/**
 * Looks up artist / key / BPM / duration / year for songs. The caller decides which fields to
 * apply (normally only the empty ones). Throws nothing: failures are reported in the result so
 * the UI can show them instead of silently doing nothing.
 */
export const enrichSongs = async (songs: SongLookup[]): Promise<EnrichResult> => {
  const result: EnrichResult = { updates: {}, failed: 0 };

  for (let i = 0; i < songs.length; i += BATCH_SIZE) {
    const batch = songs.slice(i, i + BATCH_SIZE);
    const prompt = `You are a music database. For each song below, give details of the ORIGINAL studio recording.
Rules:
- "artist": the performing artist or band. Only change it if the artist given is empty or "Unknown Artist".
- "key": the main musical key written like "G", "F#m", "Bb" or "Dm". Use "m" for minor, no words.
- "bpm": beats per minute as a whole number.
- "duration": track length as M:SS (for example 3:45).
- "year": the release year.
- If you are not reasonably confident about a value, OMIT that field. Never guess wildly.
- Return every song id exactly as given.

Songs: ${JSON.stringify(batch.map(s => ({ id: s.id, title: s.title, artist: s.artist || 'Unknown Artist', key: s.key, bpm: s.bpm, duration: s.duration, year: s.year })))}`;

    try {
      const parsed = await aiJson(prompt, {
            type: Type.OBJECT,
            properties: {
              songs: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    artist: { type: Type.STRING },
                    key: { type: Type.STRING },
                    bpm: { type: Type.NUMBER },
                    duration: { type: Type.STRING },
                    year: { type: Type.NUMBER }
                  },
                  required: ["id"]
                }
              }
            },
            required: ["songs"]
          }, [FLASH_MODEL, FLASH_MODEL], 0.2);
      const valid = new Set(batch.map(s => s.id));
      (parsed.songs || []).forEach((row: any) => {
        if (row && valid.has(row.id)) {
          const { id, ...rest } = row;
          result.updates[id] = rest;
        }
      });
    } catch (error) {
      console.error('Song lookup failed:', error);
      result.failed += batch.length;
      result.error = describeAiError(error);
    }
  }
  return result;
};

/** Single-song lookup used by the "magic scan" button on the Add Song form. */
export const getSongDetails = async (title: string, artist?: string): Promise<Partial<Song>> => {
  const { updates, error } = await enrichSongs([{ id: 'one', title, artist }]);
  if (error && !updates.one) throw new Error(error);
  return updates.one || {};
};

export const generateSampleData = async (): Promise<Song[]> => {
  const prompt = `Generate 15 popular songs (Title, Artist, Key (e.g. "G", "F#m"), BPM, Duration (e.g. 3:45), Vocalist, Year (1950-2024)). Return JSON.`;
  try {
      const data = await aiJson(prompt, {
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
              }, [FLASH_MODEL]);
      return (data.songs || []).map((s: any, i: number) => ({
        ...s,
        id: `gen-${i}-${Date.now()}`,
        rating: Math.floor(Math.random() * 5) + 1,
        isExcludedFromAuto: false
      }));
  } catch (e) { return []; }
}
