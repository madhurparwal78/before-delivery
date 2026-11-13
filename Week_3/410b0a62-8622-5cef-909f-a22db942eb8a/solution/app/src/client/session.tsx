import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Me } from '../shared/types.js';
import { get, onUnauthenticated, post } from './api.js';
import { navigate } from './router.js';

interface Session {
  me: Me | null;
  ready: boolean;
  signedIn: (me: Me) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    get<Me>('/api/me')
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setReady(true));
    return onUnauthenticated(() => setMe(null));
  }, []);

  const signOut = useCallback(async () => {
    await post('/api/auth/sign-out');
    setMe(null);
    navigate('/sign-in');
  }, []);

  const value = useMemo<Session>(() => ({ me, ready, signedIn: setMe, signOut }), [me, ready, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider is missing');
  return session;
}

/** The signed-in user; only used below the sign-in guard. */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error('no signed-in user');
  return me;
}
