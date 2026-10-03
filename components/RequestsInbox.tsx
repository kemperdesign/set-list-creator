import React from 'react';
import { Check, X, MessageSquareQuote } from 'lucide-react';
import { SongRequest, groupRequests } from '../lib/requests';

interface Props {
  requests: SongRequest[];
  onSetStatus: (ids: string[], status: 'played' | 'dismissed') => void;
  empty?: string;
}

/** Open audience requests, with the most-requested songs first. */
const RequestsInbox: React.FC<Props> = ({ requests, onSetStatus, empty }) => {
  const groups = groupRequests(requests);
  if (groups.length === 0) return <p className="text-center text-gray-500 text-sm py-8">{empty || 'No requests yet.'}</p>;
  return (
    <div className="space-y-2">
      {groups.map(g => (
        <div key={g.key} className="bg-gray-800 border border-gray-700 rounded-xl p-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-base truncate">{g.title}</span>
              {g.count > 1 && <span className="text-[11px] font-black bg-indigo-600 text-white rounded-full px-2 py-0.5 flex-shrink-0">x{g.count}</span>}
            </div>
            {g.artist && <p className="text-xs text-gray-400 truncate">{g.artist}</p>}
            {g.names.length > 0 && <p className="text-[11px] text-gray-500 mt-0.5 truncate">from {[...new Set(g.names)].join(', ')}</p>}
            {g.notes.map((n, i) => <p key={i} className="text-[11px] text-sky-300 mt-0.5 flex gap-1"><MessageSquareQuote className="w-3 h-3 mt-0.5 flex-shrink-0" />{n}</p>)}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => onSetStatus(g.ids, 'played')} className="h-10 px-3 rounded-lg bg-emerald-600/20 text-emerald-300 text-[11px] font-black uppercase flex items-center gap-1" title="Played or handled"><Check className="w-4 h-4" />Done</button>
            <button onClick={() => onSetStatus(g.ids, 'dismissed')} aria-label="Dismiss" className="h-10 w-10 rounded-lg text-gray-500 hover:text-red-400 flex items-center justify-center"><X className="w-4 h-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default RequestsInbox;
