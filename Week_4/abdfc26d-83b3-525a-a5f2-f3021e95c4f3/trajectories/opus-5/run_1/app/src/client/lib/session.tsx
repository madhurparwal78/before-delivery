import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeResponse } from '../../shared/api.js';
import { api, ApiFailure } from './api.js';

export interface Session {
  readonly user: MeResponse | null;
  readonly loading: boolean;
  readonly isCreator: boolean;
  readonly isCollector: boolean;
  readonly isFounder: boolean;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .get<MeResponse>('/api/me')
      .then((value) => {
        if (alive) setUser(value);
      })
      .catch((error: unknown) => {
        if (alive && !(error instanceof ApiFailure && error.status === 401)) {
          setUser(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<Session>(
    () => ({
      user,
      loading,
      isCreator: user?.roles.includes('creator') ?? false,
      isCollector: user?.roles.includes('collector') ?? false,
      isFounder: user?.roles.includes('founder-operator') ?? false,
      signOut: async () => {
        await api.post('/auth/logout');
        window.location.assign('/');
      },
    }),
    [user, loading],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession used outside the session provider');
  return value;
}
