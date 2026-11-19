import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiFailure, w } from './api';
import { matchPath, navigate, usePath } from './router';
import type { Me, RunDetailView, RunItem, RunStatus, StreamEvent, WorkspaceInfo } from './types';

type Listener = (event: StreamEvent) => void;

interface Shell {
  me: Me | null | undefined;
  refreshMe: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  workspace: WorkspaceInfo | null;
  setWorkspace: (workspace: WorkspaceInfo | null) => void;
  runUpdates: Array<{ id: number; line: string }>;
  notice: string;
  say: (text: string) => void;
  alert: string | null;
  raise: (message: string) => void;
  dismiss: () => void;
  subscribe: (listener: Listener) => () => void;
  /** Counts every (re)connection of the live stream; pages refetch what they show when it changes. */
  epoch: number;
  followDraft: (automationId: string | null) => void;
  seedRuns: (runs: RunItem[]) => void;
}

const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (shell === null) throw new Error('ShellProvider is missing');
  return shell;
}

const KEPT_LINES = 20;
const PAUSED = 'Live updates paused. Reconnecting...';

export function ShellProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);
  const path = usePath();
  const [lines, setLines] = useState<Array<{ id: number; line: string }>>([]);
  const [notice, setNotice] = useState('');
  const [alertText, setAlertText] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [paused, setPaused] = useState(false);
  const listeners = useRef(new Set<Listener>());
  const presence = useRef<StreamEvent | null>(null);
  const known = useRef(new Map<string, RunStatus>());
  const started = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const counter = useRef(0);
  // The stream opens from the address alone, so it is already listening before the workspace has loaded.
  const workspaceId = matchPath('/w/:ws', path)?.ws ?? matchPath('/w/:ws/:area', path)?.ws ?? matchPath('/w/:ws/:area/:item', path)?.ws ?? null;
  const draftId = matchPath('/w/:ws/automations/:aid', path)?.aid ?? followed;
  const signedIn = me !== null;

  const refreshMe = useCallback(async (): Promise<Me | null> => {
    try {
      const found = await api.get<Me>('/api/me');
      setMe(found);
      return found;
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const push = useCallback((line: string) => {
    counter.current += 1;
    const id = counter.current;
    setLines((previous) => [...previous, { id, line }].slice(-KEPT_LINES));
  }, []);

  const stepName = useCallback(async (event: Extract<StreamEvent, { type: 'run' }>, which: 'waiting' | 'failed'): Promise<string> => {
    const detail = await api.get<RunDetailView>(w(event.workspace_id, `/runs/${event.run.id}`));
    const wanted = which === 'failed' ? detail.failed_step : detail.steps.find((step) => step.status === 'waiting')?.id;
    return detail.steps.find((step) => step.id === wanted)?.name ?? '';
  }, []);

  const announce = useCallback(
    async (event: StreamEvent): Promise<void> => {
      if (event.type === 'version') return push(`Version ${event.version} published`);
      if (event.type === 'drain') return push(`Runs left on older versions: ${event.count}`);
      if (event.type !== 'run') return;
      const { run } = event;
      const before = known.current.get(run.id);
      known.current.set(run.id, run.status);
      if (run.status === 'queued' && !started.current.has(run.id)) {
        started.current.add(run.id);
        return push(`Run #${run.number} started`);
      }
      if (before === run.status) return;
      if (run.status === 'waiting') push(`Run #${run.number} is waiting at ${await stepName(event, 'waiting')}`);
      else if (run.status === 'succeeded') push(`Run #${run.number} succeeded`);
      else if (run.status === 'failed') push(`Run #${run.number} failed at ${await stepName(event, 'failed')}`);
      else if (run.status === 'cancelled') push(`Run #${run.number} was cancelled`);
    },
    [push, stepName],
  );

  useEffect(() => {
    if (workspaceId === null || !signedIn) return undefined;
    presence.current = null;
    const source = new EventSource(`/api/workspaces/${workspaceId}/events${draftId === null ? '' : `?draft=${draftId}`}`);
    source.onopen = () => {
      setPaused(false);
      setEpoch((value) => value + 1);
    };
    source.onerror = () => setPaused(source.readyState !== EventSource.CLOSED);
    source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as StreamEvent;
      if (event.type === 'presence') presence.current = event;
      listeners.current.forEach((listener) => listener(event));
      queue.current = queue.current.then(() => announce(event)).catch(() => undefined);
    };
    return () => source.close();
  }, [workspaceId, draftId, signedIn, announce]);

  const value = useMemo<Shell>(
    () => ({
      me,
      refreshMe,
      signOut: async () => {
        await api.post('/api/auth/sign-out');
        setMe(null);
        setWorkspace(null);
        navigate('/');
      },
      workspace,
      setWorkspace,
      runUpdates: lines,
      notice: paused ? PAUSED : notice,
      say: setNotice,
      alert: alertText,
      raise: setAlertText,
      dismiss: () => setAlertText(null),
      subscribe: (listener) => {
        listeners.current.add(listener);
        if (presence.current) listener(presence.current);
        return () => {
          listeners.current.delete(listener);
        };
      },
      epoch,
      followDraft: setFollowed,
      seedRuns: (runs) => {
        for (const run of runs) if (!known.current.has(run.id)) known.current.set(run.id, run.status);
      },
    }),
    [me, refreshMe, workspace, lines, notice, paused, alertText, epoch],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
