import { Song } from '../types';
import { formatKey } from './keys';

/** Plain-text version of a song for email / SMS / share sheet / clipboard. */
export function songToText(song: Song): string {
  const meta = [
    song.artist,
    formatKey(song.key) ? `Key: ${formatKey(song.key)}` : '',
    song.bpm ? `${song.bpm} BPM` : '',
    song.duration || '',
  ].filter(Boolean).join(' · ');
  return `${song.title}\n${meta}\n\n${(song.lyrics || '').trim() || '(no lyrics saved)'}\n`;
}

const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

export const mailtoHref = (song: Song) =>
  `mailto:?subject=${encodeURIComponent(`${song.title} - ${song.artist}`)}&body=${encodeURIComponent(songToText(song))}`;

/** iOS wants `sms:&body=`, Android wants `sms:?body=`. */
export const smsHref = (song: Song) =>
  `sms:${isApple() ? '&' : '?'}body=${encodeURIComponent(songToText(song))}`;

export const canNativeShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export async function nativeShare(song: Song): Promise<void> {
  await navigator.share({ title: `${song.title} - ${song.artist}`, text: songToText(song) });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Print one or more songs (one per page) through a hidden iframe. Works on desktop and iOS (via the print dialog). */
export function printSongs(songs: Song[], monospace = false, fontPx = 16) {
  const pages = songs
    .map(song => {
      const meta = [
        song.artist,
        formatKey(song.key) ? `Key ${formatKey(song.key)}` : '',
        song.bpm ? `${song.bpm} BPM` : '',
        song.duration || '',
      ].filter(Boolean).join('  ·  ');
      return `<section><h1>${escapeHtml(song.title)}</h1><p class="meta">${escapeHtml(meta)}</p><pre>${escapeHtml((song.lyrics || '').trim() || '(no lyrics saved)')}</pre></section>`;
    })
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(songs[0]?.title || 'Lyrics')}</title>
  <style>
    body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#000;margin:24px}
    section{page-break-after:always} section:last-child{page-break-after:auto}
    h1{font-size:26px;margin:0 0 4px} .meta{color:#555;margin:0 0 18px;font-size:13px}
    pre{white-space:pre-wrap;word-wrap:break-word;font-size:${fontPx}px;line-height:1.5;margin:0;
        font-family:${monospace ? "ui-monospace,Menlo,Consolas,monospace" : "inherit"}}
  </style></head><body>${pages}</body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();

  const run = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => iframe.remove(), 60_000);
    }
  };
  // give layout a tick before printing
  setTimeout(run, 150);
}
