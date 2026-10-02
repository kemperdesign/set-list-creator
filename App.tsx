
import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { supabase } from './lib/supabase';
import { BandSummary } from './types';
import AuthScreen from './components/AuthScreen';
import BandManager from './components/BandManager';
import Board, { LOCAL_BAND_ID } from './components/Board';

/**
 * Flow:
 *   no Supabase env vars  -> single local board (this device only, like the original app)
 *   signed out            -> AuthScreen (sign in / create account / reset password)
 *   signed in             -> BandManager (pick or create a band) -> Board for that band
 */
const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [recovery, setRecovery] = useState(false);
  const [band, setBand] = useState<BandSummary | null>(null);

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

  const signOut = async () => {
    await supabase?.auth.signOut();
    setBand(null);
  };

  // Local-only mode (env vars missing)
  if (!supabase) {
    return <Board band={{ id: LOCAL_BAND_ID, name: 'Set List Generator', isOwner: true }} />;
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
      userEmail={session.user.email || ''}
      onBack={() => setBand(null)}
      onSignOut={signOut}
    />
  );
};

export default App;
