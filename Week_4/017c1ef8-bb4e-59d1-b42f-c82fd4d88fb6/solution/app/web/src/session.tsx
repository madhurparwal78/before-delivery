import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { setLiveEnabled } from './live';
import type { SessionMember } from './types';

interface SessionValue {
  /** The signed-in member; null when signed out. Undefined while the first check is in flight. */
  member: SessionMember | null | undefined;
  /** Re-reads `GET /api/me` (after sign-in, confirm or a name change). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<SessionMember | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<SessionMember>('/api/me');
      setMember({ id: me.id, handle: me.handle, name: me.name });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setMember(null);
      else throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/api/auth/signout');
    setMember(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setLiveEnabled(Boolean(member));
  }, [member]);

  return <SessionContext.Provider value={{ member, refresh, signOut }}>{children}</SessionContext.Provider>;
}

/** SessionProvider wraps the whole app, so every caller has the value. */
export const useSession = (): SessionValue => useContext(SessionContext) as SessionValue;

/** The signed-in member, for pages that only render behind the session. */
export const useMember = (): SessionMember => useSession().member as SessionMember;
