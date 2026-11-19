import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { api, ApiError } from '../api/client.ts';
import type { Me, ProjectRef } from '../api/types.ts';
import { navigate } from '../router.ts';
import { connectEvents, disconnectEvents } from './events.ts';

interface Session {
  me: Me | null;
  /** Reads `GET /api/me` again, after a sign-in or a new project. */
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** `GET /api/me`, or null when nobody is signed in. */
export async function loadMe(): Promise<Me | null> {
  try {
    return await api.get<Me>('/api/me');
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) return null;
    throw caught;
  }
}

export function SessionProvider({ initial, children }: { initial: Me | null; children: ReactNode }) {
  const [me, setMe] = useState(initial);
  const userId = me?.user.id;

  useEffect(() => {
    if (userId) connectEvents();
    else disconnectEvents();
  }, [userId]);

  const value = useMemo<Session>(
    () => ({
      me,
      refresh: async () => {
        const next = await loadMe();
        setMe(next);
        return next;
      },
      signOut: async () => {
        await api.post('/api/auth/logout');
        flushSync(() => setMe(null));
        navigate('/');
      },
    }),
    [me],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession needs a SessionProvider');
  return session;
}

/** The projects the signed-in user may create sources and workbooks in. */
export function creatorProjects(me: Me | null): ProjectRef[] {
  return me ? me.projects.filter((project) => project.role === 'creator') : [];
}
