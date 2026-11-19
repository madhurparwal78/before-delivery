import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../apiClient';
import type {
  LayoutDetail,
  LayoutEventData,
  Me,
  SessionEventData,
  SessionSnapshot,
  StatusInfo,
  ViewUrlState,
  WorkspaceSummary,
} from './types';
import type { LayoutContent } from '../../shared/domain';

/**
 * The one store. Browser state derives from server events and snapshots; the
 * events are applied strictly by seq, any seq already applied is ignored, and
 * on a gap a snapshot is fetched before carrying on.
 */

export interface OutageState {
  valkeyDown: boolean;
  gotenbergDown: boolean;
}

export interface StoreState {
  me: Me | null;
  workspaces: WorkspaceSummary[];
  layout: LayoutDetail | null;
  session: SessionSnapshot | null;
  status: StatusInfo | null;
  outage: OutageState;
  sceneRevision: number;
  appliedSessionSeq: number;
  appliedLayoutSeq: number;
  loading: boolean;
}

export function useStore(initialUrl: ViewUrlState): {
  state: StoreState;
  setMe: (me: Me | null) => void;
  refreshWorkspaces: () => Promise<void>;
  loadLayout: (workspaceId: string, layoutId: string) => Promise<void>;
  applyLayoutEvent: (event: LayoutEventData) => void;
  loadSession: (workspaceId: string, sessionId: string) => Promise<void>;
  applySessionEvent: (event: SessionEventData) => void;
  setStatus: (status: StatusInfo) => void;
  setOutage: (outage: Partial<OutageState>) => void;
  markLoaded: () => void;
  requestLayoutSnapshot: () => void;
  requestSessionSnapshot: () => void;
} {
  const [state, setState] = useState<StoreState>({
    me: null,
    workspaces: [],
    layout: null,
    session: null,
    status: null,
    outage: { valkeyDown: false, gotenbergDown: false },
    sceneRevision: 0,
    appliedSessionSeq: 0,
    appliedLayoutSeq: 0,
    loading: true,
  });

  const urlRef = useRef(initialUrl);
  urlRef.current = initialUrl;

  const setMe = useCallback((me: Me | null) => {
    setState((s) => ({
      ...s,
      me,
      workspaces: (me?.memberships ?? []).map((m) => ({ id: m.workspace_id, name: m.workspace_name, role: m.role })),
    }));
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    const data = await get<{ workspaces: WorkspaceSummary[] }>('/api/workspaces');
    setState((s) => ({ ...s, workspaces: data.workspaces }));
  }, []);

  const loadLayout = useCallback(async (workspaceId: string, layoutId: string) => {
    const layout = await get<LayoutDetail>(`/api/workspaces/${workspaceId}/layouts/${layoutId}`);
    setState((s) => ({
      ...s,
      layout,
      appliedLayoutSeq: layout.revision,
      sceneRevision: Math.max(s.sceneRevision, layout.revision),
    }));
  }, []);

  const requestLayoutSnapshot = useCallback(() => {
    const url = urlRef.current;
    if (url.workspace && url.layout) void loadLayout(url.workspace, url.layout);
  }, [loadLayout]);

  const loadSession = useCallback(async (workspaceId: string, sessionId: string) => {
    const session = await get<SessionSnapshot>(`/api/workspaces/${workspaceId}/sessions/${sessionId}`);
    setState((s) => ({
      ...s,
      session,
      appliedSessionSeq: session.revision,
      sceneRevision: Math.max(s.sceneRevision, session.revision),
    }));
  }, []);

  const requestSessionSnapshot = useCallback(() => {
    const url = urlRef.current;
    if (url.workspace && url.session) void loadSession(url.workspace, url.session);
  }, [loadSession]);

  const applyLayoutEvent = useCallback((event: LayoutEventData) => {
    setState((s) => {
      if (event.seq <= s.appliedLayoutSeq) return s;
      if (event.seq > s.appliedLayoutSeq + 1) {
        // Gap: fetch a snapshot; the snapshot updates appliedLayoutSeq.
        void requestLayoutSnapshot();
        return s;
      }
      let layout = s.layout;
      if (event.layout) {
        layout = layout ? { ...layout, ...event.layout } : layout;
      }
      return {
        ...s,
        layout: layout ?? s.layout,
        appliedLayoutSeq: event.seq,
        sceneRevision: Math.max(s.sceneRevision, event.seq),
      };
    });
  }, [requestLayoutSnapshot]);

  const applySessionEvent = useCallback((event: SessionEventData) => {
    setState((s) => {
      if (event.seq <= s.appliedSessionSeq) return s;
      if (event.seq > s.appliedSessionSeq + 1) {
        void requestSessionSnapshot();
        return s;
      }
      const session = event.session ?? s.session;
      return {
        ...s,
        session: session ?? s.session,
        appliedSessionSeq: event.seq,
        sceneRevision: Math.max(s.sceneRevision, event.seq),
      };
    });
  }, [requestSessionSnapshot]);

  const setStatus = useCallback((status: StatusInfo) => {
    setState((s) => ({
      ...s,
      status,
      outage: { valkeyDown: status.valkey === 'down', gotenbergDown: status.gotenberg === 'down' },
    }));
  }, []);

  const setOutage = useCallback((outage: Partial<OutageState>) => {
    setState((s) => ({ ...s, outage: { ...s.outage, ...outage } }));
  }, []);

  const markLoaded = useCallback(() => {
    setState((s) => ({ ...s, loading: false }));
  }, []);

  return useMemo(() => ({
    state,
    setMe,
    refreshWorkspaces,
    loadLayout,
    applyLayoutEvent,
    loadSession,
    applySessionEvent,
    setStatus,
    setOutage,
    markLoaded,
    requestLayoutSnapshot,
    requestSessionSnapshot,
  }), [state, setMe, refreshWorkspaces, loadLayout, applyLayoutEvent, loadSession, applySessionEvent, setStatus, setOutage, markLoaded, requestLayoutSnapshot, requestSessionSnapshot]);
}

/** EventSource hook with the published reconnect budget and seq ordering through the store. */
export function useEventStream(
  path: string | null,
  onEvent: (event: { id: string; type: string; data: string }) => void,
  onDown: () => void,
): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onDownRef = useRef(onDown);
  onDownRef.current = onDown;

  useEffect(() => {
    if (!path) return;
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let disposed = false;
    // The app reconnects with at most 2 seconds between tries.
    const RETRY_MS = 2000;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(path);
      const lastIdRef = { value: '0' };
      const namedTypes = [
        'tick.committed', 'authority.granted', 'authority.refused', 'authority.released',
        'train.moved', 'conflict.closed', 'conflict.changed', 'session.status', 'session.version',
        'block.changed', 'turnout.changed', 'packet.changed', 'name.changed', 'resync',
        'piece.added', 'piece.changed', 'piece.removed', 'module.changed', 'version.changed', 'timetable.changed',
      ];
      const handler = (name: string) => (e: MessageEvent) => {
        if (e.lastEventId) lastIdRef.value = e.lastEventId;
        onEventRef.current({ id: e.lastEventId || lastIdRef.value, type: name, data: e.data });
      };
      for (const name of namedTypes) {
        source.addEventListener(name, (e) => handler(name)(e as MessageEvent));
      }
      source.onmessage = (e) => {
        if (e.lastEventId) lastIdRef.value = e.lastEventId;
        onEventRef.current({ id: e.lastEventId || lastIdRef.value, type: 'message', data: e.data });
      };
      source.onerror = () => {
        onDownRef.current();
        try {
          source?.close();
        } catch {
          // already closed
        }
        source = null;
        if (!disposed) {
          retryTimer = window.setTimeout(connect, RETRY_MS);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      try {
        source?.close();
      } catch {
        // already closed
      }
      source = null;
    };
  }, [path]);
}
