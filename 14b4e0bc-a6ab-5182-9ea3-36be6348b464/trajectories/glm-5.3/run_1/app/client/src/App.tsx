import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { SessionUser } from '../../shared/api';
import { apiGet } from './api';
import { SignInScreen } from './SignInScreen';
import { CatalogScreen } from './CatalogScreen';
import { GlossaryScreen } from './GlossaryScreen';
import { AdminScreen } from './AdminScreen';

export interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  refresh: () => Promise<SessionUser | null>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  ready: false,
  refresh: async () => null,
  signOut: () => undefined,
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** One activity event the screen has received. */
export interface LiveEvent {
  seq: number;
  action: string;
  target: { type: string; id: string };
}

/**
 * The activity stream (DP-81): one event per visible committed row. The cursor
 * starts at the latest seq so only later rows arrive. A stream end moves the
 * screen to /signin (DP-07).
 */
export function useActivityStream(
  signedIn: boolean,
  afterSeq: number | null
): { events: LiveEvent[]; connected: boolean } {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setEvents([]);
      setConnected(false);
      return;
    }
    const url = afterSeq !== null ? `/api/events?after_seq=${afterSeq}` : '/api/events';
    const source = new EventSource(url);
    sourceRef.current = source;
    source.onopen = (): void => setConnected(true);
    source.addEventListener('change', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { seq: number; action: string; target: { type: string; id: string } };
        setEvents((prev) => {
          if (prev.some((e) => e.seq === data.seq)) return prev;
          return [...prev, data];
        });
      } catch {
        /* an unparsable event is skipped */
      }
    });
    source.onerror = (): void => {
      // EventSource reconnects by itself; a session end is detected by GET /api/session.
      setConnected(false);
    };
    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [signedIn, afterSeq]);

  return { events, connected };
}

export function App(): ReactNode {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    const res = await apiGet<{ user?: SessionUser }>('/api/session');
    if (res.status === 401) {
      setUser(null);
      return null;
    }
    const u = res.body.user ?? null;
    setUser(u);
    return u;
  }, []);

  const signOut = useCallback((): void => {
    setUser(null);
    navigate('/signin');
  }, [navigate]);

  useEffect(() => {
    void (async () => {
      const u = await refresh();
      setReady(true);
      if (!u && location.pathname !== '/signin') {
        navigate('/signin', { replace: true });
      }
    })();
  }, [refresh, navigate, location.pathname]);

  const value = useMemo<AuthState>(() => ({ user, ready, refresh, signOut }), [user, ready, refresh, signOut]);

  if (!ready) return null;

  return (
    <AuthContext.Provider value={value}>
      <Routes>
        <Route path="/signin" element={<SignInScreen />} />
        <Route path="/catalog" element={<RequireAuth><CatalogScreen /></RequireAuth>} />
        <Route path="/glossary" element={<RequireAuth><GlossaryScreen /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><AdminScreen /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/catalog" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}

function RequireAuth({ children }: { children: ReactNode }): ReactNode {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
