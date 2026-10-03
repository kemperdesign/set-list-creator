import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Copy, Check, Printer, Download, ExternalLink } from 'lucide-react';
import Sheet from './Sheet';
import RequestsInbox from './RequestsInbox';
import { supabase } from '../lib/supabase';
import { useRequests } from '../lib/useRequests';
import { REQUESTS_SQL, fallbackRequestUrl, makeRequestCode, requestUrl } from '../lib/requests';

interface Props {
  bandId: string;
  bandName: string;
  onClose: () => void;
}

const RequestsSheet: React.FC<Props> = ({ bandId, bandName, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState<'' | 'link' | 'sql'>('');
  const [err, setErr] = useState('');
  const { requests, setStatus } = useRequests(bandId, !needsSetup && !loading);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from('setlists').select('request_code, request_enabled').eq('id', bandId).maybeSingle();
    if (error) {
      // The columns do not exist until the one-time SQL has been run.
      setNeedsSetup(/request_code|request_enabled|column|schema cache/i.test(error.message));
      setErr(error.message);
    } else {
      setNeedsSetup(false);
      setCode(data?.request_code || '');
      setEnabled(!!data?.request_enabled);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [bandId]);

  const link = code ? requestUrl(code) : '';
  useEffect(() => {
    if (!link) { setQr(''); return; }
    QRCode.toDataURL(link, { margin: 2, width: 720, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [link]);

  const toggle = async () => {
    if (!supabase) return;
    setErr('');
    const nextEnabled = !enabled;
    let nextCode = code;
    const patch: Record<string, unknown> = { request_enabled: nextEnabled };
    if (nextEnabled && !nextCode) { nextCode = makeRequestCode(); patch.request_code = nextCode; }
    const { error } = await supabase.from('setlists').update(patch).eq('id', bandId);
    if (error) {
      if (/request_code|request_enabled|column|schema cache/i.test(error.message)) setNeedsSetup(true);
      else setErr(error.code === '23505' ? 'That code is taken, try again.' : error.message);
      return;
    }
    setCode(nextCode);
    setEnabled(nextEnabled);
  };

  const copy = async (text: string, which: 'link' | 'sql') => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  };

  const printSign = () => {
    if (!qr) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    w.document.write(`<!doctype html><html><head><title>Request a song</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{font-family:Inter,Arial,sans-serif;text-align:center;margin:0;padding:40px;color:#111}
      h1{font-size:54px;margin:0 0 6px}h2{font-size:30px;font-weight:600;margin:0 0 28px;color:#444}
      img{width:min(78vw,560px);height:auto}p{font-size:22px;margin:20px 0 0;color:#333}small{display:block;margin-top:10px;font-size:16px;color:#777}
      </style></head><body><h1>Request a song!</h1><h2>${esc(bandName)}</h2><img src="${qr}" alt="QR code"/>
      <p>Scan with your phone camera</p><small>${esc(link.replace('https://', ''))}</small>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`);
    w.document.close();
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = qr;
    a.download = `${bandName.replace(/[^\w-]+/g, '_')}-request-qr.png`;
    a.click();
  };

  const btn = 'h-11 px-3 rounded-lg text-xs font-black uppercase flex items-center justify-center gap-2';

  return (
    <Sheet title={<><QrCode className="w-4 h-4 text-sky-300" /> Song requests</>} onClose={onClose} wide>
      <div className="p-4 space-y-5 text-sm">
        {loading ? (
          <p className="text-gray-500 text-center py-8">Loading...</p>
        ) : needsSetup ? (
          <div className="space-y-3">
            <p className="font-bold text-white">One-time setup (about a minute)</p>
            <ol className="list-decimal pl-5 space-y-1 text-gray-300 text-xs">
              <li>Tap <b>Copy setup SQL</b> below.</li>
              <li>Open your Supabase project, go to <b>SQL Editor</b>, paste it, and press <b>Run</b>.</li>
              <li>Come back here and tap <b>I ran it</b>.</li>
            </ol>
            <button onClick={() => copy(REQUESTS_SQL, 'sql')} className={`${btn} w-full bg-indigo-600 text-white`}>{copied === 'sql' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied === 'sql' ? 'Copied' : 'Copy setup SQL'}</button>
            <button onClick={load} className={`${btn} w-full bg-gray-800 text-gray-200`}>I ran it</button>
            {err && <p className="text-[11px] text-gray-600 break-words">{err}</p>}
          </div>
        ) : (
          <>
            <label className="flex items-center gap-3 p-3 bg-gray-800 rounded-xl">
              <input type="checkbox" checked={enabled} onChange={toggle} className="w-5 h-5 accent-indigo-500" />
              <span>
                <span className="block font-bold text-gray-100">Accept song requests</span>
                <span className="block text-[11px] text-gray-500">The audience picks from your library and sets (never the Do Not Play list).</span>
              </span>
            </label>
            {err && <p className="text-xs text-amber-400">{err}</p>}

            {enabled && code && (
              <>
                <div className="bg-white rounded-xl p-4 flex flex-col items-center gap-2">
                  {qr ? <img src={qr} alt="QR code for song requests" className="w-56 h-56" /> : <div className="w-56 h-56" />}
                  <p className="text-xs text-gray-700 font-mono break-all text-center">{link.replace('https://', '')}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={printSign} className={`${btn} bg-indigo-600 text-white`}><Printer className="w-4 h-4" /> Print sign</button>
                  <button onClick={download} className={`${btn} bg-gray-800 text-gray-200`}><Download className="w-4 h-4" /> Save QR image</button>
                  <button onClick={() => copy(link, 'link')} className={`${btn} bg-gray-800 text-gray-200`}>{copied === 'link' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />} {copied === 'link' ? 'Copied' : 'Copy link'}</button>
                  <a href={link} target="_blank" rel="noreferrer" className={`${btn} bg-gray-800 text-gray-200`}><ExternalLink className="w-4 h-4" /> Preview</a>
                </div>
                <p className="text-[11px] text-gray-500">
                  If the page does not open yet, the requests.auggystyle.com address is not connected. You can use this address in the meantime: <span className="font-mono break-all text-gray-400">{fallbackRequestUrl(code).replace('https://', '')}</span>
                </p>
              </>
            )}

            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase mb-2">Requests from the audience ({requests.length})</p>
              <RequestsInbox requests={requests} onSetStatus={setStatus} empty={enabled ? 'Nothing yet. Requests appear here live and as an alert in Stage mode.' : 'Turn on requests to start receiving them.'} />
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
};

export default RequestsSheet;
