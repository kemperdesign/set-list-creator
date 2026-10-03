import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { SongRequest } from './requests';

/**
 * The band's request inbox: loads open requests and keeps them live. `onNew` fires for each request
 * that arrives while this is mounted (used for the Stage alert).
 */
export const useRequests = (bandId: string, active: boolean, onNew?: (r: SongRequest) => void) => {
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [error, setError] = useState('');
  const cb = useRef(onNew);
  cb.current = onNew;

  const load = useCallback(async () => {
    if (!supabase || !active) return;
    const { data, error } = await supabase.from('song_requests').select('*').eq('setlist_id', bandId).eq('status', 'new').order('created_at', { ascending: false }).limit(300);
    if (error) { setError(error.message); return; }
    setError('');
    setRequests((data || []) as SongRequest[]);
  }, [bandId, active]);

  useEffect(() => {
    if (!supabase || !active) return;
    const sb = supabase;
    load();
    const ch = sb.channel(`requests-${bandId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'song_requests', filter: `setlist_id=eq.${bandId}` }, (p: any) => {
        if (p.eventType === 'INSERT') {
          const r = p.new as SongRequest;
          setRequests(prev => (prev.some(x => x.id === r.id) ? prev : [r, ...prev]));
          cb.current?.(r);
        } else if (p.eventType === 'UPDATE') {
          const r = p.new as SongRequest;
          setRequests(prev => (r.status === 'new' ? prev.map(x => (x.id === r.id ? r : x)) : prev.filter(x => x.id !== r.id)));
        } else if (p.eventType === 'DELETE') {
          setRequests(prev => prev.filter(x => x.id !== p.old?.id));
        }
      })
      .subscribe(st => { if (st === 'SUBSCRIBED') load(); });
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); sb.removeChannel(ch); };
  }, [bandId, active, load]);

  const setStatus = async (ids: string[], status: 'played' | 'dismissed') => {
    setRequests(prev => prev.filter(r => !ids.includes(r.id)));
    await supabase?.from('song_requests').update({ status }).in('id', ids);
  };

  return { requests, error, reload: load, setStatus };
};
