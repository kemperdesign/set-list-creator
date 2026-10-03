import React, { useState } from 'react';
import { Lightbulb, Send } from 'lucide-react';
import Sheet from './Sheet';
import { fireCue, isHttpMixedContent } from '../lib/cues';

interface Props {
  enabled: boolean;
  url: string;
  bandId: string;
  bandName: string;
  onChange: (next: { webhookEnabled: boolean; webhookUrl: string }) => void;
  onClose: () => void;
}

const LightsSheet: React.FC<Props> = ({ enabled, url, bandId, bandName, onChange, onClose }) => {
  const [msg, setMsg] = useState('');
  const mixed = !!url && isHttpMixedContent(url);
  const input = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:ring-1 focus:ring-indigo-500 outline-none';

  const test = async () => {
    setMsg('Sending...');
    const ok = await fireCue(url, 'test', { bandId, bandName });
    setMsg(ok ? 'Test sent. Check your lights or recorder. (The browser cannot read the reply, so this only confirms it was sent.)' : mixed ? 'Blocked: this page is https, so the address must be https too (or localhost).' : 'Enter a full https:// address first.');
  };

  return (
    <Sheet title={<><Lightbulb className="w-4 h-4 text-yellow-300" /> Lights and cues</>} onClose={onClose} wide>
      <div className="p-4 space-y-4 text-sm">
        <p className="text-xs text-gray-400">
          In Stage mode the app sends a message to a web address when a song starts and when it ends. Use it to trigger lights, scenes or a recording through any tool that accepts a webhook.
          Give a song its own cue text (Details tab) such as a scene name, and it is included in the message.
        </p>

        <label className="flex items-center gap-3 p-3 bg-gray-800 rounded-xl">
          <input type="checkbox" checked={enabled} onChange={e => onChange({ webhookEnabled: e.target.checked, webhookUrl: url })} className="w-5 h-5 accent-indigo-500" />
          <span className="font-bold text-gray-100">Send cues from Stage mode</span>
        </label>

        <div>
          <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Webhook address</label>
          <input className={input} inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://..." value={url} onChange={e => onChange({ webhookEnabled: enabled, webhookUrl: e.target.value.trim() })} />
          {mixed && <p className="text-xs text-amber-400 mt-1">This site is https, so browsers block http:// addresses on your network. Use an https address (a tunnel or a cloud service) or a bridge running on this device (localhost).</p>}
        </div>

        <button onClick={test} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase rounded-lg flex items-center justify-center gap-2">
          <Send className="w-4 h-4" /> Send a test cue
        </button>
        {msg && <p className="text-xs text-gray-400">{msg}</p>}

        <div>
          <p className="text-[10px] font-black text-gray-500 uppercase mb-1">What gets sent (JSON, POST)</p>
          <pre className="text-[11px] leading-snug bg-gray-950 border border-gray-800 rounded-lg p-3 overflow-x-auto text-gray-300">{`{
  "event": "song_start",   // or "song_end"
  "timestamp": "2026-10-03T21:05:00Z",
  "band": { "id": "...", "name": "Auggy Style" },
  "set": "Set 1",
  "position": 3, "total": 12,
  "next": "Next song title",
  "cue": "red wash, slow fade",
  "song": { "title": "...", "artist": "...",
    "key": "G", "bpm": 120, "duration": "3:45",
    "vocalist": "...", "cue": "..." }
}`}</pre>
        </div>

        <p className="text-xs text-gray-500">
          Works with Zapier or Make, Node-RED, Bitfocus Companion, Home Assistant, and OBS or recording tools that take webhooks. DMX, MIDI and OSC rigs need a small bridge that receives this message; tell me what you use and I can add a direct connection.
        </p>
      </div>
    </Sheet>
  );
};

export default LightsSheet;
