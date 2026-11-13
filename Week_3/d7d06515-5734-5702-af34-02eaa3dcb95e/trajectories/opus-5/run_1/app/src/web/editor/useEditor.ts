import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityEntry,
  Collaborator,
  CommandResult,
  Drawing,
  DrawingObject,
  IssueRow,
  MeasureResult,
  Point,
  Trace,
} from '../../shared/api';
import { PROMPTS } from '../../shared/commands';
import { copy } from '../../shared/copy';
import { ApiFailure, errorCopy, openEventStream, request } from '../api';
import { announce } from '../shell';
import { CommandMachine } from './machine';
import type { PanelTab } from './panels';

export type SyncState = 'synced' | 'syncing' | 'paused' | 'conflict';

export interface DraftingAids {
  OSNAP: boolean;
  ORTHO: boolean;
  POLAR: boolean;
  'SNAP & GRID': boolean;
  OTRACK: boolean;
}

export const AID_HISTORY: Record<keyof DraftingAids, string> = {
  OSNAP: 'Osnap',
  ORTHO: 'Ortho',
  POLAR: 'Polar',
  'SNAP & GRID': 'Snap',
  OTRACK: 'Otrack',
};

export interface EditorModel {
  drawing: Drawing | null;
  drawingRef: React.MutableRefObject<Drawing | null>;
  reload: () => Promise<Drawing | null>;
  historyLines: string[];
  pushHistory: (line: string) => void;
  prompt: string;
  machine: CommandMachine;
  selection: string[];
  setSelection: (handles: string[]) => void;
  selected: DrawingObject[];
  aids: DraftingAids;
  toggleAid: (aid: keyof DraftingAids) => void;
  sync: { state: SyncState; version: number };
  collaborators: Collaborator[];
  activity: ActivityEntry[];
  issues: IssueRow[];
  trial: { days_left: number; ended: boolean };
  linkStatus: 'active' | 'expired' | 'revoked';
  conflict: number | null;
  loadLatest: () => void;
  changed: string[];
  trace: Trace | null;
  authoredTraces: string[];
  rememberAuthored: (id: string) => void;
  openTrace: (id: string) => Promise<void>;
  closeTraceView: () => void;
  panel: PanelTab;
  setPanel: (tab: PanelTab) => void;
  runBase: (command: string, args: Record<string, unknown>) => Promise<CommandResult | null>;
  runTrace: (command: string, args: Record<string, unknown>) => Promise<boolean>;
  measure: (first: Point, second: Point) => Promise<MeasureResult>;
  insertDefaults: React.MutableRefObject<{ block: string; scale: number; rotation: number }>;
  refresh: () => void;
  tabId: string;
  valkeyPaused: boolean;
  zoomExtentsRef: React.MutableRefObject<() => void>;
  zoomByRef: React.MutableRefObject<(factor: number) => void>;
}

export function useEditor(options: {
  drawingId: string;
  actorName: string;
  linkToken: string | null;
  onLinkDead: (status: 'expired' | 'revoked') => void;
}): EditorModel {
  const { drawingId } = options;
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const drawingRef = useRef<Drawing | null>(null);
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<string>(PROMPTS.idle);
  const [selection, setSelectionState] = useState<string[]>([]);
  const [aids, setAids] = useState<DraftingAids>({
    OSNAP: true,
    ORTHO: false,
    POLAR: false,
    'SNAP & GRID': false,
    OTRACK: false,
  });
  const [sync, setSync] = useState<{ state: SyncState; version: number }>({ state: 'synced', version: 1 });
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [trial, setTrial] = useState({ days_left: 30, ended: false });
  const [linkStatus, setLinkStatus] = useState<'active' | 'expired' | 'revoked'>('active');
  const [conflict, setConflict] = useState<number | null>(null);
  const [changed, setChanged] = useState<string[]>([]);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [panel, setPanel] = useState<PanelTab>('Properties');
  const [valkeyPaused, setValkeyPaused] = useState(false);
  const [, setTick] = useState(0);
  const insertDefaults = useRef({ block: 'Door 900', scale: 1, rotation: 0 });
  const tabId = useMemo(() => Math.random().toString(36).slice(2), []);

  const selectionRef = useRef<string[]>(selection);
  const traceRef = useRef<Trace | null>(trace);
  const trialRef = useRef(trial);
  const zoomExtentsRef = useRef<() => void>(() => undefined);
  const zoomByRef = useRef<(factor: number) => void>(() => undefined);
  selectionRef.current = selection;
  traceRef.current = trace;
  trialRef.current = trial;

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  const pushHistory = useCallback((line: string) => {
    setHistoryLines((current) => [...current.slice(-200), line]);
  }, []);

  const reload = useCallback(async (): Promise<Drawing | null> => {
    try {
      const next = await request<Drawing>('GET', `/api/drawings/${drawingId}`);
      drawingRef.current = next;
      setDrawing(next);
      setSync((current) => ({ state: current.state === 'paused' ? 'paused' : 'synced', version: next.version }));
      return next;
    } catch (failure) {
      if (failure instanceof ApiFailure && (failure.code === 'link_expired' || failure.code === 'link_revoked')) {
        options.onLinkDead(failure.code === 'link_expired' ? 'expired' : 'revoked');
      }
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingId]);

  const loadActivity = useCallback(async () => {
    const result = await request<{ entries: ActivityEntry[] }>('GET', `/api/drawings/${drawingId}/activity`);
    setActivity(result.entries);
  }, [drawingId]);

  const loadIssues = useCallback(async () => {
    const result = await request<{ issues: IssueRow[] }>('GET', `/api/drawings/${drawingId}/issues`);
    setIssues(result.issues);
  }, [drawingId]);

  useEffect(() => {
    void reload();
    void loadActivity();
    void loadIssues();
    if (options.linkToken === null) {
      void request('POST', `/api/drawings/${drawingId}/opened`, {}).catch(() => undefined);
    }
  }, [drawingId, reload, loadActivity, loadIssues, options.linkToken]);

  const holdTimers = useRef<number[]>([]);

  useEffect(() => {
    const suffix = options.linkToken === null ? `?tab=${tabId}` : `?tab=${tabId}&link=${options.linkToken}`;
    return openEventStream(`/api/drawings/${drawingId}/events${suffix}`, {
      change: (data: { version: number; changed: string[]; actor: string; command: string }) => {
        void reload();
        void loadActivity();
        if (data.actor !== options.actorName) {
          setChanged(data.changed);
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const timer = window.setTimeout(() => setChanged([]), reduced ? 1400 : 2460);
          holdTimers.current.push(timer);
        }
      },
      presence: (data: { collaborators: Collaborator[] }) => setCollaborators(data.collaborators),
      link: (data: { status: string }) => {
        if (data.status === 'revoked' || data.status === 'expired') {
          setLinkStatus(data.status);
          if (options.linkToken !== null) options.onLinkDead(data.status);
        }
      },
      trace: (data: { trace: { id: string; announcement?: string } }) => {
        void reload();
        void loadIssues();
        if (typeof data.trace.announcement === 'string') announce(data.trace.announcement);
      },
      issues: (data: { issues: IssueRow[] }) => setIssues(data.issues),
      activity: (data: { entry: ActivityEntry }) => setActivity((current) => [data.entry, ...current]),
      trial: (data: { days_left: number; ended: boolean }) => setTrial(data),
      sync: (data: { state: 'live' | 'paused' }) => {
        setValkeyPaused(data.state === 'paused');
        setSync((current) =>
          data.state === 'paused'
            ? { state: 'paused', version: current.version }
            : { state: 'synced', version: current.version },
        );
        if (data.state === 'live') void reload();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingId, reload, loadActivity, loadIssues, tabId]);

  useEffect(() => {
    return () => {
      for (const timer of holdTimers.current) window.clearTimeout(timer);
    };
  }, []);

  const sendPresence = useCallback(() => {
    void request('POST', `/api/drawings/${drawingId}/presence`, { tab_id: tabId }).catch(() => undefined);
  }, [drawingId, tabId]);

  useEffect(() => {
    sendPresence();
    let last = 0;
    const onInput = (): void => {
      const now = Date.now();
      if (now - last < 2000) return;
      last = now;
      sendPresence();
    };
    window.addEventListener('keydown', onInput);
    window.addEventListener('pointerdown', onInput);
    return () => {
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('pointerdown', onInput);
    };
  }, [sendPresence]);

  const setSelection = useCallback((handles: string[]) => {
    setSelectionState(handles);
  }, []);

  const toggleAid = useCallback(
    (aid: keyof DraftingAids) => {
      setAids((current) => {
        const next: DraftingAids = { ...current, [aid]: !current[aid] };
        if (aid === 'ORTHO' && next.ORTHO) next.POLAR = false;
        if (aid === 'POLAR' && next.POLAR) next.ORTHO = false;
        pushHistory(copy.history.toggle(AID_HISTORY[aid], next[aid]));
        return next;
      });
    },
    [pushHistory],
  );

  const runBase = useCallback(
    async (command: string, args: Record<string, unknown>): Promise<CommandResult | null> => {
      const current = drawingRef.current;
      if (current === null) return null;
      setSync({ state: 'syncing', version: current.version });
      try {
        const result = await request<CommandResult>('POST', `/api/drawings/${drawingId}/commands`, {
          base_version: current.version,
          command,
          args,
        });
        if (result.history !== null) {
          pushHistory(result.history);
          announce(result.history);
        }
        await reload();
        setSync({ state: 'synced', version: result.version });
        if (result.created.length > 0) setSelectionState(result.created);
        return result;
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          if (failure.code === 'version_conflict') {
            const list = (failure.extra.changed as string[] | undefined) ?? [];
            setConflict(list.length);
            setSync({ state: 'conflict', version: Number(failure.extra.current_version ?? current.version) });
            return null;
          }
          if (failure.code === 'link_expired' || failure.code === 'link_revoked') {
            options.onLinkDead(failure.code === 'link_expired' ? 'expired' : 'revoked');
            return null;
          }
          const text = errorCopy(failure, 'command');
          pushHistory(text);
          announce(text);
          setSync({ state: 'synced', version: current.version });
        }
        return null;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [drawingId, pushHistory, reload],
  );

  const runTrace = useCallback(
    async (command: string, args: Record<string, unknown>): Promise<boolean> => {
      const active = traceRef.current;
      if (active === null) return false;
      try {
        const result = await request<{ trace: Trace }>('POST', `/api/traces/${active.id}/commands`, {
          command,
          args,
        });
        setTrace(result.trace);
        return true;
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          const text = errorCopy(failure, 'command');
          pushHistory(text);
          announce(text);
        }
        return false;
      }
    },
    [pushHistory],
  );

  const measure = useCallback(
    async (first: Point, second: Point): Promise<MeasureResult> =>
      await request<MeasureResult>('POST', `/api/drawings/${drawingId}/measure`, { first, second }),
    [drawingId],
  );

  const [authoredTraces, setAuthoredTraces] = useState<string[]>(() => {
    const stored = window.sessionStorage.getItem(`corbel-authored-${drawingId}`);
    return stored === null ? [] : (JSON.parse(stored) as string[]);
  });

  const rememberAuthored = useCallback(
    (id: string) => {
      setAuthoredTraces((current) => {
        const next = current.includes(id) ? current : [...current, id];
        window.sessionStorage.setItem(`corbel-authored-${drawingId}`, JSON.stringify(next));
        return next;
      });
    },
    [drawingId],
  );

  const openTrace = useCallback(async (id: string) => {
    const result = await request<{ trace: Trace }>('GET', `/api/traces/${id}`);
    setTrace(result.trace);
  }, []);

  const closeTraceView = useCallback(() => setTrace(null), []);

  const machine = useMemo(
    () =>
      new CommandMachine({
        drawing: () => drawingRef.current!,
        units: () => drawingRef.current?.units ?? 'mm',
        history: pushHistory,
        announce,
        refresh: () => {
          refresh();
        },
        runBase,
        runTrace,
        measure,
        setSelection,
        getSelection: () => selectionRef.current,
        zoomExtents: () => zoomExtentsRef.current(),
        zoomBy: (factor) => zoomByRef.current(factor),
        openPanel: (tab) => setPanel(tab as PanelTab),
        activeTrace: () => traceRef.current,
        insertDefaults: () => insertDefaults.current,
        access: () => drawingRef.current?.access ?? 'view',
        trialEnded: () => trialRef.current.ended,
      }),
    [pushHistory, refresh, runBase, runTrace, measure, setSelection],
  );

  useEffect(() => {
    setPrompt(machine.currentPrompt());
  });

  const loadLatest = useCallback(() => {
    setConflict(null);
    void reload();
  }, [reload]);

  const selected = useMemo(() => {
    if (drawing === null) return [];
    if (trace !== null) {
      return trace.objects.filter((object) => selection.includes(object.handle));
    }
    return drawing.objects.filter((object) => selection.includes(object.handle));
  }, [drawing, selection, trace]);

  return {
    drawing,
    drawingRef,
    reload,
    historyLines,
    pushHistory,
    prompt,
    machine,
    selection,
    setSelection,
    selected,
    aids,
    toggleAid,
    sync,
    collaborators,
    activity,
    issues,
    trial,
    linkStatus,
    conflict,
    loadLatest,
    changed,
    trace,
    authoredTraces,
    rememberAuthored,
    openTrace,
    closeTraceView,
    panel,
    setPanel,
    runBase,
    runTrace,
    measure,
    insertDefaults,
    refresh,
    tabId,
    valkeyPaused,
    zoomExtentsRef,
    zoomByRef,
  };
}
