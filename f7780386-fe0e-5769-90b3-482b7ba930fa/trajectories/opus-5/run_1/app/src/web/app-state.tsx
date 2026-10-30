import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { KitchenInfo, User } from '../shared/api.js';
import { ApiError, NetworkError, api } from './api.js';
import { syncServerNow } from './clock.js';

export interface LiveMessages {
  updates: string;
  problems: string;
}

export interface AppState {
  user: User | null;
  kitchen: KitchenInfo | null;
  balanceMinutes: number | null;
  live: LiveMessages;
  pending: (copy: string) => void;
  succeed: (copy: string) => void;
  report: (copy: string) => void;
  clearMessages: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  navigate: (path: string) => void;
  path: string;
  reducedMotion: boolean;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const found = useContext(AppContext);
  if (found === null) throw new Error('AppContext is missing');
  return found;
}

export const SESSION_ENDED = 'Your session ended. Sign in again.';
export const UNREACHABLE = 'Passboard could not reach the server. Nothing changed; try again.';

function homeFor(user: User): string {
  if (user.role === 'operator') return '/review';
  if (user.role === 'crew_cook') return '/shifts';
  return '/board';
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [kitchen, setKitchen] = useState<KitchenInfo | null>(null);
  const [balanceMinutes, setBalance] = useState<number | null>(null);
  const [live, setLive] = useState<LiveMessages>({ updates: '', problems: '' });
  const [path, setPath] = useState(window.location.pathname);
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = (): void => setReducedMotion(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const navigate = useCallback((next: string) => {
    if (pathRef.current !== next) {
      window.history.pushState({}, '', next);
      setPath(next);
    }
  }, []);

  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const pending = useCallback((copy: string) => {
    setLive({ updates: copy, problems: '' });
  }, []);
  const succeed = useCallback((copy: string) => {
    setLive({ updates: copy, problems: '' });
  }, []);
  const report = useCallback((copy: string) => {
    setLive({ updates: '', problems: copy });
  }, []);
  const clearMessages = useCallback(() => setLive({ updates: '', problems: '' }), []);

  const loadKitchen = useCallback(async () => {
    const info = await api<KitchenInfo>('/api/kitchen');
    syncServerNow(info.now);
    setKitchen(info);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const me = await api<{ user: User; balance_minutes: number | null }>('/api/me');
      setUser(me.user);
      setBalance(me.balance_minutes);
      await loadKitchen();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setBalance(null);
        return;
      }
      if (error instanceof NetworkError) return;
      throw error;
    }
  }, [loadKitchen]);

  useEffect(() => {
    void refreshSession().finally(() => setReady(true));
  }, [refreshSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api<{ user: User }>('/api/session', {
        method: 'POST',
        body: { email, password },
      });
      setUser(result.user);
      await loadKitchen();
      const me = await api<{ balance_minutes: number | null }>('/api/me');
      setBalance(me.balance_minutes);
      setLive({ updates: '', problems: '' });
      window.history.pushState({}, '', homeFor(result.user));
      setPath(homeFor(result.user));
    },
    [loadKitchen],
  );

  const signOut = useCallback(async () => {
    await api('/api/session', { method: 'DELETE' });
    setUser(null);
    setBalance(null);
    setKitchen(null);
    setLive({ updates: '', problems: '' });
    window.history.pushState({}, '', '/');
    setPath('/');
  }, []);

  const value = useMemo<AppState>(
    () => ({
      user,
      kitchen,
      balanceMinutes,
      live,
      pending,
      succeed,
      report,
      clearMessages,
      signIn,
      signOut,
      refreshSession,
      navigate,
      path,
      reducedMotion,
    }),
    [
      user,
      kitchen,
      balanceMinutes,
      live,
      pending,
      succeed,
      report,
      clearMessages,
      signIn,
      signOut,
      refreshSession,
      navigate,
      path,
      reducedMotion,
    ],
  );

  if (!ready) return null;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Wraps an action in the shared pending / success / refusal pattern, and
 * returns to sign-in when the session has ended.
 */
export function useAction(): (
  pendingCopy: string,
  run: () => Promise<string | null>,
  describe: (error: ApiError) => string,
) => Promise<void> {
  const app = useApp();
  return useCallback(
    async (pendingCopy, run, describe) => {
      app.pending(pendingCopy);
      try {
        const success = await run();
        if (success !== null) app.succeed(success);
      } catch (error) {
        if (error instanceof NetworkError) {
          app.report(UNREACHABLE);
          return;
        }
        if (error instanceof ApiError) {
          if (error.status === 401) {
            await app.refreshSession();
            app.report(SESSION_ENDED);
            app.navigate('/');
            return;
          }
          app.report(describe(error));
          return;
        }
        throw error;
      }
    },
    [app],
  );
}
