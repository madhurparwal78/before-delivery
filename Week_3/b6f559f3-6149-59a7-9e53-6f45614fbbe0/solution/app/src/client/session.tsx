import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeResponse, SessionUser } from '../shared/protocol';
import { api, ApiError } from './api';

interface SessionState {
  status: 'loading' | 'out' | 'in';
  user: SessionUser | null;
  workspaces: MeResponse['workspaces'];
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<{ status: 'loading' | 'out' | 'in'; data: MeResponse | null }>({ status: 'loading', data: null });

  const refresh = useCallback(async () => {
    try {
      setMe({ status: 'in', data: await api.get<MeResponse>('/api/me') });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setMe({ status: 'out', data: null });
      else throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.delete('/api/session');
    setMe({ status: 'out', data: null });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionState>(
    () => ({ status: me.status, user: me.data?.user ?? null, workspaces: me.data?.workspaces ?? [], refresh, signOut }),
    [me, refresh, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession needs a SessionProvider');
  return value;
}
