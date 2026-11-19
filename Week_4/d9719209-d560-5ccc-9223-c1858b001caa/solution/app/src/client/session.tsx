import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OwnAccount } from '../shared/types.js';
import { ApiError, api } from './api.js';
import { announce } from './announce.js';
import { restartLive, useLive } from './live.js';
import { navigate } from './router.js';

interface SessionValue {
  user: OwnAccount | null;
  loading: boolean;
  /** Reads /api/me again (after sign-in, verification or two-factor setup). */
  refresh: () => Promise<OwnAccount | null>;
  /** Ends the session on the server and shows the signed-out state. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession needs a SessionProvider');
  return value;
}

async function readMe(): Promise<OwnAccount | null> {
  try {
    return await api<OwnAccount>('GET', '/api/me');
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<OwnAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await readMe().catch(() => null);
    setUser(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signedInId = user?.id ?? null;
  useEffect(() => {
    if (!loading) restartLive();
  }, [signedInId, loading]);

  useLive([], (event, data) => {
    if (event === 'account' && (data as { kind: string }).kind === 'suspended') {
      setUser(null);
      announce('Your account has been suspended', true);
    }
  });

  const signOut = useCallback(async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    setUser(null);
    navigate('/');
  }, []);

  const value = useMemo(() => ({ user, loading, refresh, signOut }), [user, loading, refresh, signOut]);
  // The first paint waits for /api/me (one small read) so the masthead's account controls render once, at their final
  // size: painting a signed-out header and then growing it pushed the whole page down (layout shift at 320-390 px).
  return <SessionContext.Provider value={value}>{loading ? null : children}</SessionContext.Provider>;
}
