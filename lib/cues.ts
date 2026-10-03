import { Song } from '../types';
import { formatKey } from './keys';

export type CueEvent = 'song_start' | 'song_end' | 'test';

export interface CueContext {
  bandId: string;
  bandName: string;
  song?: Song;
  setTitle?: string;
  position?: number;
  total?: number;
  nextTitle?: string;
}

export const isHttpMixedContent = (url: string) =>
  typeof location !== 'undefined' && location.protocol === 'https:' && /^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(url);

/**
 * Generic outbound cue: POSTs JSON to the webhook. Point it at anything that accepts a webhook
 * (Zapier/Make, Node-RED, Bitfocus Companion, a Home Assistant automation, OBS via a plugin, or a small
 * bridge that turns it into DMX/MIDI/OSC). Sent as text/plain so browsers do not require a CORS preflight.
 * Never throws: stage use must not be interrupted by a lighting problem.
 */
export const fireCue = async (url: string | undefined, event: CueEvent, ctx: CueContext): Promise<boolean> => {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (isHttpMixedContent(url)) return false;
  const s = ctx.song;
  const body = {
    event,
    timestamp: new Date().toISOString(),
    band: { id: ctx.bandId, name: ctx.bandName },
    set: ctx.setTitle,
    position: ctx.position,
    total: ctx.total,
    next: ctx.nextTitle,
    song: s ? {
      id: s.id, title: s.title, artist: s.artist, key: formatKey(s.key) || undefined,
      bpm: s.bpm, duration: s.duration, vocalist: s.vocalist, cue: s.cue,
    } : undefined,
    cue: s?.cue,
  };
  try {
    await fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
    return true;
  } catch {
    return false;
  }
};
