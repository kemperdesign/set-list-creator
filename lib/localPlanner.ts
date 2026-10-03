import { GeneratorConfig, Song } from '../types';

/**
 * Built-in planner. It needs no internet and no AI, so building sets can never fail.
 * It follows the same rules as the AI planner: higher-rated songs first, hit each set's target
 * minutes, era preference, mixed tempos and no back-to-back singers. Key grouping is applied by the
 * caller afterwards, exactly as it is for AI results.
 */

const DEFAULT_MIN = 3.5;

export const songMinutes = (s: Song): number => {
  const m = /^(\d+):(\d{2})$/.exec(s.duration || '');
  return m ? Number(m[1]) + Number(m[2]) / 60 : DEFAULT_MIN;
};

const eraScore = (s: Song, era: GeneratorConfig['era']): number => {
  if (!s.year || era === 'mixed') return 0;
  if (era === 'old') return s.year < 1990 ? 1 : -1;
  return s.year >= 1990 ? 1 : -1;
};

// Unrated songs count as average so they are not buried.
const priority = (s: Song, era: GeneratorConfig['era']) => (s.rating || 3) * 2 + eraScore(s, era);

/** Orders one set for flow: strong opener and closer, alternating tempo, rotating singers. */
export const orderSetLocally = (songs: Song[], config: Pick<GeneratorConfig, 'mixTempos' | 'separateSingers' | 'era'>): string[] => {
  if (songs.length < 3) return songs.map(s => s.id);
  const bpms = songs.map(s => s.bpm).filter((b): b is number => !!b).sort((a, b) => a - b);
  const median = bpms.length ? bpms[Math.floor(bpms.length / 2)] : 0;
  const isFast = (s: Song) => !!s.bpm && !!median && s.bpm >= median;

  const remaining = [...songs].sort((a, b) => priority(b, config.era) - priority(a, config.era));
  const out: Song[] = [remaining.shift()!];

  while (remaining.length) {
    const prev = out[out.length - 1];
    let best = 0;
    let bestScore = -Infinity;
    remaining.forEach((s, i) => {
      let score = priority(s, config.era) * 0.5;
      if (config.separateSingers && s.vocalist && prev.vocalist && s.vocalist === prev.vocalist) score -= 10;
      if (config.mixTempos && s.bpm && prev.bpm && isFast(s) === isFast(prev)) score -= 3;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    out.push(remaining.splice(best, 1)[0]);
  }

  // Finish strong: move the best remaining-rated song among the last third to the end.
  const tail = Math.max(1, Math.floor(out.length / 3));
  let bi = out.length - 1;
  for (let i = out.length - tail; i < out.length; i++) if (priority(out[i], config.era) > priority(out[bi], config.era)) bi = i;
  if (bi !== out.length - 1) out.push(out.splice(bi, 1)[0]);

  // Repair pass: swap songs around until no singer repeats back to back (when it is possible).
  if (config.separateSingers) {
    const clash = (a?: Song, b?: Song) => !!a && !!b && !!a.vocalist && a.vocalist === b.vocalist;
    const conflicts = () => out.reduce((n, s, i) => n + (i && clash(out[i - 1], s) ? 1 : 0), 0);
    for (let pass = 0; pass < 6 && conflicts() > 0; pass++) {
      for (let i = 1; i < out.length; i++) {
        if (!clash(out[i - 1], out[i])) continue;
        for (let j = 0; j < out.length; j++) {
          if (j === i || j === i - 1) continue;
          const before = conflicts();
          [out[i], out[j]] = [out[j], out[i]];
          if (conflicts() < before) break;
          [out[i], out[j]] = [out[j], out[i]];
        }
      }
    }
  }

  return out.map(s => s.id);
};

/** Picks songs for each set and orders them. Returns setId -> song ids. */
export const planSetsLocally = (
  library: Song[],
  setIds: string[],
  config: GeneratorConfig
): Record<string, string[]> => {
  const eligible = library.filter(s => !s.isExcludedFromAuto);
  const plan: Record<string, string[]> = {};
  setIds.forEach(id => { plan[id] = []; });
  if (eligible.length === 0 || setIds.length === 0) return plan;

  const targets = setIds.map(id => config.setDurations?.[id] || 0);
  const known = targets.filter(t => t > 0);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const wanted = targets.map(t => t || fallback);

  // No targets at all: split the whole library evenly.
  const ranked = [...eligible].sort((a, b) => priority(b, config.era) - priority(a, config.era) || a.title.localeCompare(b.title));
  const buckets: Song[][] = setIds.map(() => []);
  const minutes: number[] = setIds.map(() => 0);

  if (!wanted.some(w => w > 0)) {
    ranked.forEach((s, i) => {
      // snake order keeps every set's quality even
      const round = Math.floor(i / setIds.length);
      const pos = i % setIds.length;
      buckets[round % 2 === 0 ? pos : setIds.length - 1 - pos].push(s);
    });
  } else {
    // Best songs first; each goes to the set that is furthest from its target.
    for (const s of ranked) {
      let pick = -1;
      let gap = 0;
      wanted.forEach((w, i) => {
        const g = w - minutes[i];
        if (g > gap) { gap = g; pick = i; }
      });
      if (pick === -1) break; // every set is full
      buckets[pick].push(s);
      minutes[pick] += songMinutes(s);
    }
  }

  setIds.forEach((id, i) => {
    plan[id] = orderSetLocally(buckets[i], config);
  });
  return plan;
};
