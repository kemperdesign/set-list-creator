
import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { supabase } from './lib/supabase';
import { BandSummary } from './types';
import AuthScreen from './components/AuthScreen';
import BandManager from './components/BandManager';
import Board, { LOCAL_BAND_ID } from './components/Board';
import RequestPage from './components/RequestPage';

/** Audience request link: requests.auggystyle.com/<code>, /?b=<code> or /r/<code>. */
const getRequestCode = (): { isRequests: boolean; code: string | null } => {
  const u = new URL(window.location.href);
  const parts = u.pathname.split('/').filter(Boolean);
  const onHost = window.location.hostname.startsWith('requests.');
  const code = u.searchParams.get('b') || (parts[0] === 'r' ? parts[1] : onHost ? parts[0] : null) || null;
  return { isRequests: onHost || parts[0] === 'r' || !!u.searchParams.get('b'), code };
};

/**
 * Flow:
 *   no Supabase env vars  -> single local board (this device only, like the original app)
 *   signed out            -> AuthScreen (sign in / create account / reset password)
 *   signed in             -> BandManager (pick or create a band) -> Board for that band
 */
const App: React.FC = () => {
  const req = getRequestCode();
  if (req.isRequests) return <RequestPage code={req.code} />;

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [recovery, setRecovery] = useState(false);
  const [band, setBand] = useState<BandSummary | null>(null);
  // Stage window link: /?stage=<bandId> opens that band straight into Stage mode.
  const stageParam = new URLSearchParams(window.location.search).get('stage');
  const [stageBandId] = useState<string | null>(stageParam);
  const [stageTried, setStageTried] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setBand(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session || !stageBandId || stageBandId === 'local' || band || stageTried) return;
    setStageTried(true);
    supabase.from('setlists').select('*').eq('id', stageBandId).maybeSingle().then(({ data }) => {
      if (data) setBand(data as BandSummary);
    });
  }, [session, stageBandId, band, stageTried]);

  const signOut = async () => {
    await supabase?.auth.signOut();
    setBand(null);
  };

  // Local-only mode (env vars missing)
  if (!supabase) {
    return <Board band={{ id: LOCAL_BAND_ID, name: 'Set List Generator', isOwner: true }} startInStage={!!stageParam} />;
  }

  if (!authReady) {
    return (
      <div className="h-[100dvh] bg-gray-950 flex items-center justify-center text-gray-500 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!session || recovery) {
    return <AuthScreen recovery={recovery && !!session} onRecoveryDone={() => setRecovery(false)} />;
  }

  if (!band) {
    return (
      <BandManager
        userId={session.user.id}
        email={session.user.email || ''}
        onOpen={setBand}
        onSignOut={signOut}
      />
    );
  }

  return (
    <Board
      key={band.id}
      band={{ id: band.id, name: band.name, isOwner: band.user_id === session.user.id }}
      startInStage={!!stageBandId && stageBandId === band.id}
      userEmail={session.user.email || ''}
      onBack={() => setBand(null)}
      onSignOut={signOut}
    />
  );
};

export default App;
