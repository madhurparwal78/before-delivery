import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isFailure, type ApiMember, type ApiWorkspace } from './client';

export interface MeResponse {
  member: ApiMember;
  workspace: ApiWorkspace;
  today: string;
}

interface SessionState {
  me: MeResponse | null;
  loading: boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<MeResponse>('/api/me');
      setMe(res);
    } catch (e) {
      if (isFailure(e) && e.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/sign-out');
    } catch {
      /* the cookie is cleared regardless */
    }
    setMe(null);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ me, loading, reload, signOut }), [me, loading, reload, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (ctx === null) throw new Error('SessionProvider is missing');
  return ctx;
}

// ---------------------------------------------------------------------------
// Status announcements: the single polite live region "Planner updates".

interface AnnouncerState {
  message: string;
  announce: (text: string) => void;
}

const AnnouncerContext = createContext<AnnouncerState | null>(null);

export function AnnouncerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((text: string) => {
    if (timer.current !== null) clearTimeout(timer.current);
    // Clear then set, so identical messages re-announce.
    setMessage('');
    timer.current = setTimeout(() => setMessage(text), 30);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ message, announce }), [message, announce]);
  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="visually-hidden" data-testid="planner-updates">
        {message}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): AnnouncerState {
  const ctx = useContext(AnnouncerContext);
  if (ctx === null) throw new Error('AnnouncerProvider is missing');
  return ctx;
}

/** The session cookie is a fixed name, so browser fetch includes it by default. */
export const SIGN_OUT = 'Sign out';
