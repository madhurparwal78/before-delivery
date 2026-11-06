import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User, Workspace } from '../shared/types';
import { ApiError, request, setUnauthenticatedHandler, watchRequests } from './api';

export interface AppState {
  user: User | null;
  workspace: Workspace | null;
  ready: boolean;
  saveStatus: string;
  pending: string;
  alert: string;
  evidenceAnnouncement: string;
  boardAnnouncement: string;
  busy: boolean;
  setSaveStatus: (message: string) => void;
  setPending: (message: string) => void;
  setAlert: (message: string) => void;
  announceEvidence: (message: string) => void;
  announceBoard: (message: string) => void;
  signIn: (user: User) => void;
  signOut: () => void;
  reloadSession: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (state === null) throw new Error('App state is only available inside the provider');
  return state;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [pending, setPending] = useState('');
  const [alert, setAlert] = useState('');
  const [evidenceAnnouncement, setEvidenceAnnouncement] = useState('');
  const [boardAnnouncement, setBoardAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);

  const reloadSession = useCallback(async () => {
    try {
      const me = await request<{ user: User; workspace: Workspace }>('/api/me');
      setUser(me.user);
      setWorkspace(me.workspace);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setWorkspace(null);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reloadSession();
  }, [reloadSession]);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser(null);
      setWorkspace(null);
      setAlert('Your session ended. Sign in again.');
      if (location.pathname !== '/signin') history.pushState({}, '', '/signin');
      dispatchEvent(new PopStateEvent('popstate'));
    });
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    return watchRequests((count) => {
      if (count > 0) {
        if (timer === undefined) timer = window.setTimeout(() => setBusy(true), 300);
      } else {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        setBusy(false);
      }
    });
  }, []);

  const value = useMemo<AppState>(
    () => ({
      user,
      workspace,
      ready,
      saveStatus,
      pending,
      alert,
      evidenceAnnouncement,
      boardAnnouncement,
      busy,
      setSaveStatus: (message) => {
        setPending('');
        setSaveStatus(message);
        if (message !== '') setAlert('');
      },
      setPending,
      setAlert: (message) => {
        setPending('');
        setAlert(message);
      },
      announceEvidence: setEvidenceAnnouncement,
      announceBoard: setBoardAnnouncement,
      signIn: (next) => {
        setUser(next);
        setAlert('');
        void reloadSession();
      },
      signOut: () => {
        setUser(null);
        setWorkspace(null);
      },
      reloadSession,
    }),
    [
      user,
      workspace,
      ready,
      saveStatus,
      pending,
      alert,
      evidenceAnnouncement,
      boardAnnouncement,
      busy,
      reloadSession,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
