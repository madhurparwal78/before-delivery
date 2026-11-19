import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { api, ApiFailure, downloadBlob, w } from '../api';
import { Link, useNavState, useTitle } from '../router';
import { useShell } from '../shell';
import { Button, Skeleton, useAccess, useReducedMotion, useWide } from '../ui';
import type { DraftView, GraphEdge, GraphNode, NodeKind, RunDetailView, RunItem, StepStatus, StreamEvent, TableView, TriggerNode, WorkspaceInfo } from '../types';
import { Canvas, type CanvasNode, type GhostView, type Preview, type TokenView } from '../studio/Canvas';
import { CELL, COLUMNS, PORTS, ROWS, TOOLBAR, executionOrder, nearestInDirection, outgoing, outPortAt } from '../studio/geometry';
import { KindIcon } from '../studio/KindIcon';
import { SettingsDialog, type Patch } from '../studio/SettingsDialog';
import { StepList, type ListItem } from '../studio/StepList';
import { NotFound } from './NotFound';
import '../build/styles/studio.css';

const SAVED = 'Draft saved. Not live until you publish.';
const DRAG_THRESHOLD = 4;
const ACTIVE: StepStatus[] = ['running', 'waiting', 'retrying'];

type Focus = { kind: 'cursor' } | { kind: 'step'; id: string } | { kind: 'edge'; id: string };

interface Op {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface ActiveRun {
  version: number;
  atStep: string;
}

function Numeral({ version }: { version: number | null }) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return <NumeralDigits key={version ?? 'none'} version={version} animate={mounted.current} />;
}

function NumeralDigits({ version, animate }: { version: number | null; animate: boolean }) {
  const [stepped] = useState(animate);
  if (version === null) return <span className="numeral">No version</span>;
  return (
    <span className="numeral tabular">
      {[...`v${version}`].map((character, index) => (
        <span key={index} className={stepped ? 'digit stepped' : 'digit'} style={{ animationDelay: `${index * 30}ms` }}>
          {character}
        </span>
      ))}
    </span>
  );
}

export function Editor({ workspace, automationId }: { workspace: WorkspaceInfo; automationId: string }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const wide = useWide();
  const access = useAccess();
  const reduced = useReducedMotion();
  const navState = useNavState<{ draftNotice?: string }>();
  const ws = workspace.id;
  const base = w(ws, `/automations/${automationId}`);

  const [draft, setDraft] = useState<DraftView | null>(null);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState(navState?.draftNotice ?? '');
  const [others, setOthers] = useState<string[]>([]);
  const [cursor, setCursor] = useState({ col: 2, row: 2 });
  const [drawing, setDrawing] = useState<{ from: string; port: string; target: string | null } | null>(null);
  const [dialog, setDialog] = useState<{ id: string; opener: HTMLElement | null } | null>(null);
  const [animating, setAnimating] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [toolGhost, setToolGhost] = useState<{ kind: NodeKind; x: number; y: number } | null>(null);
  const [tables, setTables] = useState<TableView[]>([]);
  const [active, setActive] = useState<Record<string, ActiveRun>>({});
  const [versions, setVersions] = useState<Record<number, DraftView>>({});
  const [busy, setBusy] = useState<'publish' | 'test' | 'run' | 'export' | null>(null);
  const [runInput, setRunInput] = useState('{}');
  const [lastRun, setLastRun] = useState<{ id: string; number: number } | null>(null);

  const draftRef = useRef<DraftView | null>(null);
  const revision = useRef(0);
  const latest = useRef(0);
  /** Bumped by every pushed version or drain change, so a load that read the draft before the push keeps it. */
  const pushed = useRef(0);
  const known = useRef<Set<string> | null>(null);
  const pending = useRef<Focus | null>(null);
  const suppressClick = useRef(false);
  const undoStack = useRef<Op[]>([]);
  const redoStack = useRef<Op[]>([]);
  const pageRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  useTitle(draft?.name ?? 'Automation');

  /** Every change to the draft goes through here so a newly drawn edge, or one pushed by another member, draws in. */
  const applyDraft = useCallback(
    (next: DraftView) => {
      draftRef.current = next;
      revision.current = Math.max(revision.current, next.revision);
      const ids = next.edges.map((edge) => edge.id);
      if (known.current === null) known.current = new Set(ids);
      else {
        const fresh = ids.filter((id) => !(known.current as Set<string>).has(id));
        fresh.forEach((id) => (known.current as Set<string>).add(id));
        if (fresh.length > 0 && !reduced) setAnimating((current) => new Set([...current, ...fresh]));
      }
      setDraft(next);
    },
    [reduced],
  );

  const patch = useCallback(
    (change: (current: DraftView) => DraftView) => {
      if (draftRef.current) applyDraft(change(draftRef.current));
    },
    [applyDraft],
  );

  const load = useCallback(async () => {
    const turn = ++latest.current;
    const since = pushed.current;
    try {
      const next = await api.get<DraftView>(base);
      const current = draftRef.current;
      if (turn !== latest.current) return;
      if (since !== pushed.current && current) applyDraft({ ...next, live_version: current.live_version, drain_count: current.drain_count });
      else applyDraft(next);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
      else throw error;
    }
  }, [base, applyDraft]);

  const loadRuns = useCallback(async () => {
    const { runs } = await api.get<{ runs: RunItem[] }>(w(ws, `/runs?automation=${automationId}`));
    shellRef.current.seedRuns(runs);
    const live = runs.filter((run) => ['queued', 'running', 'waiting'].includes(run.status) && run.version !== null).slice(0, 20);
    const details = await Promise.all(live.map((run) => api.get<RunDetailView>(w(ws, `/runs/${run.id}`))));
    const next: Record<string, ActiveRun> = {};
    details.forEach((detail) => {
      next[detail.id] = { version: detail.version as number, atStep: detail.steps.find((step) => ACTIVE.includes(step.status))?.id ?? 'trigger' };
    });
    setActive(next);
  }, [ws, automationId]);

  useEffect(() => {
    void load();
    void loadRuns();
    void api.get<{ tables: TableView[] }>(w(ws, '/tables')).then((result) => setTables(result.tables));
  }, [shell.epoch, load, loadRuns, ws]);

  const { followDraft, subscribe, me } = shell;
  useEffect(() => {
    followDraft(automationId);
    return () => followDraft(null);
  }, [automationId, followDraft]);

  useEffect(
    () =>
      subscribe((event: StreamEvent) => {
        if (event.type === 'draft' && event.automation_id === automationId && event.revision > revision.current) void load();
        else if (event.type === 'presence' && event.automation_id === automationId) setOthers(event.members.filter((member) => member.id !== me?.id).map((member) => member.name));
        else if (event.type === 'version' && event.automation_id === automationId) {
          pushed.current += 1;
          patch((current) => ({ ...current, live_version: event.version }));
        } else if (event.type === 'drain' && event.automation_id === automationId) {
          pushed.current += 1;
          patch((current) => ({ ...current, drain_count: event.count }));
        } else if (event.type === 'run' && event.run.automation_id === automationId && !event.run.test) {
          const status = event.run.status;
          setActive((current) => {
            const { [event.run.id]: before, ...rest } = current;
            if (!['queued', 'running', 'waiting'].includes(status) || event.run.version === null) return rest;
            const at = event.steps.find((step) => ACTIVE.includes(step.status))?.id ?? before?.atStep ?? 'trigger';
            return { ...rest, [event.run.id]: { version: event.run.version, atStep: at } };
          });
        }
      }),
    [subscribe, automationId, me?.id, load, patch],
  );

  const liveVersion = draft?.live_version ?? null;
  useEffect(() => {
    const wanted = new Set(Object.values(active).map((run) => run.version));
    wanted.forEach((version) => {
      if (versions[version] === undefined) {
        void api.get<DraftView>(`${base}/versions/${version}`).then((found) => setVersions((current) => ({ ...current, [version]: found })));
      }
    });
  }, [active, versions, base, liveVersion]);

  const ghosts: GhostView[] = useMemo(() => {
    if (!draft || liveVersion === null || draft.drain_count === 0) return [];
    const older = [...new Set(Object.values(active).map((run) => run.version))].filter((version) => version < liveVersion).sort();
    return older.flatMap((version) => {
      const found = versions[version];
      return found ? [{ version, nodes: [found.trigger, ...found.steps], edges: found.edges }] : [];
    });
  }, [active, versions, draft, liveVersion]);

  const tokens: TokenView[] = useMemo(() => {
    const slots = new Map<string, number>();
    return Object.entries(active).flatMap(([runId, run]) => {
      const owner = ghosts.find((ghost) => ghost.version === run.version)?.nodes.find((node) => node.id === run.atStep) ?? (draft ? [draft.trigger, ...draft.steps].find((node) => node.id === run.atStep) : undefined);
      if (!owner) return [];
      const key = `${run.version}:${run.atStep}`;
      const slot = slots.get(key) ?? 0;
      slots.set(key, slot + 1);
      return [{ runId, version: run.version, atStep: run.atStep, col: owner.col, row: owner.row, slot }];
    });
  }, [active, ghosts, draft]);

  const nodes: CanvasNode[] = useMemo(() => (draft ? [draft.trigger, ...draft.steps].map((node) => ({ id: node.id, kind: node.kind, name: node.name, col: node.col, row: node.row })) : []), [draft]);
  const order = useMemo(() => (draft ? executionOrder(draft.trigger, draft.steps, draft.edges) : []), [draft]);
  const nodeOf = useCallback((id: string): GraphNode | TriggerNode | undefined => {
    const current = draftRef.current;
    return current ? [current.trigger, ...current.steps].find((node) => node.id === id) : undefined;
  }, []);

  const requestFocus = (focus: Focus): void => {
    pending.current = focus;
    setDraft((current) => (current ? { ...current } : current));
  };

  const findStepElement = (id: string): HTMLElement | null =>
    pageRef.current?.querySelector<HTMLElement>(`button.node[data-step-id="${id}"]`) ?? pageRef.current?.querySelector<HTMLElement>(`li[data-step-id="${id}"] button`) ?? null;

  useLayoutEffect(() => {
    const focus = pending.current;
    if (!focus) return;
    const element =
      focus.kind === 'cursor'
        ? regionRef.current?.querySelector<HTMLElement>('[data-cursor]')
        : focus.kind === 'step'
          ? findStepElement(focus.id)
          : regionRef.current?.querySelector<HTMLElement>(`.edge[data-edge-id="${focus.id}"]:not(.ghost)`);
    if (!element) return;
    pending.current = null;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  const firstRender = useRef(true);
  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    regionRef.current?.querySelector<HTMLElement>('[data-cursor]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cursor]);

  /** Confirms an accepted change, unless an edge is being drawn and its prompt is still the message that matters. */
  const saved = (): void => setNotice((current) => (current.startsWith('Drawing an edge') ? current : SAVED));

  const fail = (error: unknown): void => {
    if (error instanceof ApiFailure) setNotice(error.message);
    else throw error;
  };

  /* ---- draft operations ---- */

  const addStepRaw = async (kind: NodeKind, col: number, row: number, id?: string): Promise<GraphNode | null> => {
    try {
      const step = await api.post<GraphNode>(`${base}/draft/steps`, { kind, col, row, ...(id ? { id } : {}) });
      patch((current) => ({ ...current, steps: [...current.steps.filter((existing) => existing.id !== step.id), step] }));
      saved();
      return step;
    } catch (error) {
      fail(error);
      return null;
    }
  };

  const moveStepRaw = async (id: string, col: number, row: number): Promise<boolean> => {
    try {
      const result = await api.put<{ step: GraphNode; revision: number }>(`${base}/draft/steps/${id}`, { col, row });
      revision.current = Math.max(revision.current, result.revision);
      patch((current) => ({
        ...current,
        trigger: id === 'trigger' ? { ...current.trigger, col, row } : current.trigger,
        steps: current.steps.map((step) => (step.id === id ? { ...step, col, row } : step)),
      }));
      saved();
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };

  const removeStepRaw = async (id: string): Promise<boolean> => {
    try {
      await api.del(`${base}/draft/steps/${id}`);
      patch((current) => ({
        ...current,
        steps: current.steps.filter((step) => step.id !== id),
        edges: current.edges.filter((edge) => edge.from !== id && edge.to !== id),
      }));
      saved();
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };

  const addEdgeRaw = async (from: string, port: string, to: string): Promise<GraphEdge | null> => {
    try {
      const edge = await api.post<GraphEdge>(`${base}/draft/edges`, { from, port, to });
      patch((current) => ({ ...current, edges: [...current.edges, edge] }));
      saved();
      return edge;
    } catch (error) {
      fail(error);
      return null;
    }
  };

  const removeEdgeRaw = async (id: string): Promise<boolean> => {
    try {
      await api.del(`${base}/draft/edges/${id}`);
      patch((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== id) }));
      saved();
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };

  const edgeId = (from: string, port: string, to: string): string | undefined =>
    draftRef.current?.edges.find((edge) => edge.from === from && edge.port === port && edge.to === to)?.id;

  const record = (op: Op): void => {
    undoStack.current.push(op);
    redoStack.current = [];
  };

  const toCursor = (col: number, row: number): void => {
    setCursor({ col, row });
    requestFocus({ kind: 'cursor' });
  };

  const addAt = async (kind: NodeKind, col: number, row: number): Promise<void> => {
    const step = await addStepRaw(kind, col, row);
    if (!step) return;
    const id = step.id;
    record({
      undo: async () => {
        if (await removeStepRaw(id)) toCursor(col, row);
      },
      redo: async () => {
        if (await addStepRaw(kind, col, row, id)) requestFocus({ kind: 'step', id });
      },
    });
    setCursor({ col, row });
    requestFocus({ kind: 'step', id });
  };

  const moveTo = async (id: string, col: number, row: number): Promise<void> => {
    const node = nodeOf(id);
    if (!node || (node.col === col && node.row === row)) return;
    const [oldCol, oldRow] = [node.col, node.row];
    if (!(await moveStepRaw(id, col, row))) return;
    record({
      undo: async () => {
        if (await moveStepRaw(id, oldCol, oldRow)) requestFocus({ kind: 'step', id });
      },
      redo: async () => {
        if (await moveStepRaw(id, col, row)) requestFocus({ kind: 'step', id });
      },
    });
  };

  const deleteStep = async (id: string): Promise<void> => {
    const node = nodeOf(id);
    const current = draftRef.current;
    if (!node || !current) return;
    const lost = current.edges.filter((edge) => edge.from === id || edge.to === id);
    if (!(await removeStepRaw(id))) return;
    const { kind, col, row } = node;
    record({
      undo: async () => {
        if (!(await addStepRaw(kind as NodeKind, col, row, id))) return;
        for (const edge of lost) await addEdgeRaw(edge.from, edge.port, edge.to);
        requestFocus({ kind: 'step', id });
      },
      redo: async () => {
        if (await removeStepRaw(id)) toCursor(col, row);
      },
    });
    toCursor(col, row);
  };

  const connect = async (from: string, port: string, to: string): Promise<boolean> => {
    const edge = await addEdgeRaw(from, port, to);
    if (!edge) return false;
    record({
      undo: async () => {
        const id = edgeId(from, port, to);
        if (id && (await removeEdgeRaw(id))) requestFocus({ kind: 'step', id: from });
      },
      redo: async () => {
        if (await addEdgeRaw(from, port, to)) requestFocus({ kind: 'step', id: to });
      },
    });
    return true;
  };

  const deleteEdge = async (id: string): Promise<void> => {
    const edge = draftRef.current?.edges.find((candidate) => candidate.id === id);
    if (!edge || !(await removeEdgeRaw(id))) return;
    const { from, port, to } = edge;
    record({
      undo: async () => {
        if (await addEdgeRaw(from, port, to)) requestFocus({ kind: 'step', id: from });
      },
      redo: async () => {
        const again = edgeId(from, port, to);
        if (again && (await removeEdgeRaw(again))) requestFocus({ kind: 'step', id: from });
      },
    });
    requestFocus({ kind: 'step', id: from });
  };

  const undo = async (): Promise<void> => {
    const op = undoStack.current.pop();
    if (!op) return;
    await op.undo();
    redoStack.current.push(op);
  };

  const redo = async (): Promise<void> => {
    const op = redoStack.current.pop();
    if (!op) return;
    await op.redo();
    undoStack.current.push(op);
  };

  const saveStep = async (id: string, change: Patch): Promise<boolean> => {
    try {
      const result = await api.put<{ step: GraphNode; revision: number }>(`${base}/draft/steps/${id}`, change);
      revision.current = Math.max(revision.current, result.revision);
      replaceNode(result.step);
      saved();
      return true;
    } catch (error) {
      if (error instanceof ApiFailure) {
        setNotice(error.message);
        if (error.status === 409 && error.body.step) replaceNode(error.body.step as unknown as GraphNode);
        return false;
      }
      throw error;
    }
  };

  const replaceNode = (node: GraphNode): void =>
    patch((current) => ({
      ...current,
      trigger: node.id === 'trigger' ? (node as TriggerNode) : current.trigger,
      steps: current.steps.map((step) => (step.id === node.id ? node : step)),
    }));

  /* ---- page actions ---- */

  const publish = async (): Promise<void> => {
    setBusy('publish');
    try {
      const result = await api.post<{ version: number }>(`${base}/publish`);
      pushed.current += 1;
      patch((current) => ({ ...current, live_version: result.version }));
      setNotice('');
    } catch (error) {
      if (error instanceof ApiFailure) {
        setNotice(error.message);
        if (typeof error.body.step_id === 'string') requestFocus({ kind: 'step', id: error.body.step_id });
      } else throw error;
    } finally {
      setBusy(null);
    }
  };

  const startRun = async (test: boolean): Promise<void> => {
    setBusy(test ? 'test' : 'run');
    try {
      let input: unknown = runInput;
      try {
        input = JSON.parse(runInput);
      } catch {
        input = runInput;
      }
      const result = await api.post<{ run_id: string; number: number }>(`${base}/runs`, test ? { test: true } : { input });
      setLastRun({ id: result.run_id, number: result.number });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const exportLive = async (): Promise<void> => {
    if (liveVersion === null) return;
    setBusy('export');
    shell.say('Saving export...');
    try {
      const blob = await downloadBlob(`${base}/versions/${liveVersion}/export`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${draft?.name ?? 'automation'}-v${liveVersion}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      shell.say('Export saved');
    } catch (error) {
      shell.say('');
      if (error instanceof ApiFailure) shell.raise(error.status === 503 ? 'Storage is unavailable. Nothing was saved.' : error.message);
      else throw error;
    } finally {
      setBusy(null);
    }
  };

  const openDialog = (id: string, opener: HTMLElement | null): void => setDialog({ id, opener });

  /* ---- keyboard ---- */

  const startDrawing = (id: string, port: string): void => {
    const node = nodeOf(id);
    if (!node) return;
    setDrawing({ from: id, port, target: null });
    setNotice(`Drawing an edge from ${node.name} (${port}). Choose a target and press Enter.`);
    requestFocus({ kind: 'step', id });
  };

  const chooseTarget = (id: string): void => {
    setDrawing((current) => (current ? { ...current, target: id } : current));
    requestFocus({ kind: 'step', id });
  };

  const onDrawingKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const state = drawingRef.current as NonNullable<typeof drawing>;
    const current = draftRef.current;
    if (!current) return;
    const { key } = event;
    if (key === 'Escape') {
      event.preventDefault();
      setDrawing(null);
      setNotice('');
      requestFocus({ kind: 'step', id: state.from });
    } else if (key === 'Enter') {
      event.preventDefault();
      if (state.target === null) return;
      const target = state.target;
      setDrawing(null);
      setNotice('');
      void connect(state.from, state.port, target).then((ok) => {
        if (!ok) requestFocus({ kind: 'step', id: state.from });
      });
    } else if (key.startsWith('Arrow')) {
      event.preventDefault();
      const all = [current.trigger, ...current.steps];
      const origin = nodeOf(state.target ?? state.from) as GraphNode;
      const next = nearestInDirection(origin, all.filter((node) => node.id !== state.from && node.id !== (state.target ?? '')), key);
      if (next) chooseTarget(next.id);
    } else if (key === 'Tab') {
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      let at = order.indexOf(state.target ?? state.from);
      do at = (at + step + order.length) % order.length;
      while (order[at] === state.from && order.length > 1);
      const next = order[at];
      if (next && next !== state.from) chooseTarget(next);
    } else if (key.toLowerCase() === 'c' && !event.shiftKey) {
      event.preventDefault();
      const node = nodeOf(state.from) as GraphNode;
      const ports = PORTS[node.kind];
      const port = ports[(ports.indexOf(state.port) + 1) % ports.length] as string;
      setDrawing({ ...state, port });
      setNotice(`Drawing an edge from ${node.name} (${port}). Choose a target and press Enter.`);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement;
    const current = draftRef.current;
    if (!current || target.closest('input, textarea, select')) return;
    const { key } = event;
    const lower = key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey && (lower === 'z' || lower === 'y')) {
      event.preventDefault();
      if (access.canWrite) void (lower === 'y' || event.shiftKey ? redo() : undo());
      return;
    }
    if (event.altKey || modifier) return;
    let where: Focus | null = null;
    if (target.closest('[data-cursor]')) where = { kind: 'cursor' };
    else if (target.closest('.edge')) where = { kind: 'edge', id: (target.closest('.edge') as HTMLElement).getAttribute('data-edge-id') as string };
    else {
      const group = target.closest('.node-group');
      const id = group?.querySelector<HTMLElement>('.node')?.dataset.stepId;
      if (id) where = { kind: 'step', id };
    }
    if (!where) return;
    if (drawingRef.current && access.canWrite) {
      onDrawingKey(event);
      return;
    }
    const write = access.canWrite;
    if (key.startsWith('Arrow')) {
      event.preventDefault();
      const [dc, dr] = key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : key === 'ArrowUp' ? [0, -1] : [0, 1];
      if (where.kind === 'cursor') {
        const at = cursorRef.current;
        setCursor({ col: Math.min(COLUMNS, Math.max(1, at.col + dc)), row: Math.min(ROWS, Math.max(1, at.row + dr)) });
      } else if (where.kind === 'step' && write) {
        const node = nodeOf(where.id);
        if (node && node.col + dc >= 1 && node.col + dc <= COLUMNS && node.row + dr >= 1 && node.row + dr <= ROWS) void moveTo(node.id, node.col + dc, node.row + dr);
      }
      return;
    }
    const tool = key.length === 1 ? TOOLBAR.find((entry) => entry.key === lower) : undefined;
    if (tool) {
      event.preventDefault();
      if (write) void addAt(tool.kind, cursorRef.current.col, cursorRef.current.row);
      return;
    }
    if (key === 'Enter' && where.kind === 'step') {
      event.preventDefault();
      openDialog(where.id, findStepElement(where.id));
    } else if (key === 'Escape') {
      if (where.kind === 'step') {
        const node = nodeOf(where.id);
        if (node) toCursor(node.col, node.row);
      } else if (where.kind === 'edge') {
        const edge = current.edges.find((candidate) => candidate.id === (where as { id: string }).id);
        if (edge) requestFocus({ kind: 'step', id: edge.from });
      }
    } else if (lower === 'c' && where.kind === 'step' && write) {
      event.preventDefault();
      const node = nodeOf(where.id);
      if (node) startDrawing(node.id, PORTS[node.kind][0] as string);
    } else if (key === '.' && where.kind !== 'cursor') {
      event.preventDefault();
      const from = where.kind === 'step' ? where.id : current.edges.find((candidate) => candidate.id === (where as { id: string }).id)?.from;
      const node = from ? nodeOf(from) : undefined;
      if (!node) return;
      const edges = outgoing(node.kind, node.id, current.edges);
      if (edges.length === 0) return;
      const at = where.kind === 'edge' ? edges.findIndex((edge) => edge.id === (where as { id: string }).id) : -1;
      requestFocus({ kind: 'edge', id: (edges[(at + 1) % edges.length] as GraphEdge).id });
    } else if (key === 'Delete' && write) {
      event.preventDefault();
      if (where.kind === 'step') void deleteStep(where.id);
      else if (where.kind === 'edge') void deleteEdge(where.id);
    } else if (key === 'Tab') {
      const from = where.kind === 'edge' ? current.edges.find((candidate) => candidate.id === (where as { id: string }).id)?.from : where.kind === 'step' ? where.id : null;
      if (where.kind === 'cursor' && !event.shiftKey && order[0]) {
        event.preventDefault();
        requestFocus({ kind: 'step', id: order[0] });
      } else if (from) {
        const at = order.indexOf(from);
        if (event.shiftKey) {
          event.preventDefault();
          requestFocus(at > 0 ? { kind: 'step', id: order[at - 1] as string } : { kind: 'cursor' });
        } else if (at < order.length - 1) {
          event.preventDefault();
          requestFocus({ kind: 'step', id: order[at + 1] as string });
        }
      }
    }
  };

  /* ---- pointer ---- */

  const worldPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = (worldRef.current as HTMLDivElement).getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const cellAt = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const region = regionRef.current?.getBoundingClientRect();
    if (!region || clientX < region.left || clientX > region.right || clientY < region.top || clientY > region.bottom) return null;
    const point = worldPoint(clientX, clientY);
    return {
      col: Math.min(COLUMNS, Math.max(1, Math.floor(point.x / CELL) + 1)),
      row: Math.min(ROWS, Math.max(1, Math.floor(point.y / CELL) + 1)),
    };
  };

  const track = (onMove: (event: PointerEvent) => void, onUp: (event: PointerEvent) => void): void => {
    const finish = (event: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      onUp(event);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const onNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode): void => {
    suppressClick.current = false;
    if (event.button !== 0 || !access.canWrite) return;
    const start = { x: event.clientX, y: event.clientY };
    let dragged = false;
    track(
      (move) => {
        const dx = move.clientX - start.x;
        const dy = move.clientY - start.y;
        if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragged = true;
        setMoving({ id: node.id, dx, dy });
      },
      (up) => {
        if (!dragged) return;
        suppressClick.current = true;
        const size = CELL;
        const col = Math.min(COLUMNS, Math.max(1, node.col + Math.round((up.clientX - start.x) / size)));
        const row = Math.min(ROWS, Math.max(1, node.row + Math.round((up.clientY - start.y) / size)));
        setMoving({ id: node.id, dx: (col - node.col) * size, dy: (row - node.row) * size });
        void moveTo(node.id, col, row).finally(() => setMoving(null));
      },
    );
  };

  const onPortPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode, port: string): void => {
    if (event.button !== 0 || !access.canWrite) return;
    event.preventDefault();
    const origin = outPortAt(node.kind, port, node.col, node.row);
    track(
      (move) => {
        const point = worldPoint(move.clientX, move.clientY);
        setPreview({ x1: origin.x, y1: origin.y, x2: point.x, y2: point.y });
      },
      (up) => {
        setPreview(null);
        const hit = document.elementFromPoint(up.clientX, up.clientY)?.closest<HTMLElement>('[data-in-port]');
        const to = hit?.dataset.inPort;
        if (to) void connect(node.id, port, to);
      },
    );
  };

  const onToolPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, kind: NodeKind): void => {
    suppressClick.current = false;
    if (event.button !== 0 || !access.canWrite) return;
    const start = { x: event.clientX, y: event.clientY };
    let dragged = false;
    track(
      (move) => {
        if (!dragged && Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_THRESHOLD) return;
        dragged = true;
        setToolGhost({ kind, x: move.clientX, y: move.clientY });
      },
      (up) => {
        setToolGhost(null);
        if (!dragged) return;
        suppressClick.current = true;
        const at = cellAt(up.clientX, up.clientY);
        if (at) void addAt(kind, at.col, at.row);
      },
    );
  };

  const onNodeClick = (node: CanvasNode, element: HTMLElement): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    element.focus();
    openDialog(node.id, element);
  };

  /* ---- render ---- */

  if (missing) return <NotFound />;
  if (!draft) return <Skeleton rows={5} />;

  const dialogNode = dialog ? nodeOf(dialog.id) : undefined;
  const lock = access.locked();
  const exportLock = lock.disabled ? lock : liveVersion === null ? { disabled: true as const, 'aria-describedby': 'reason-export' } : {};
  const items: ListItem[] = order.map((id) => nodeOf(id) as GraphNode).map((node) => ({ id: node.id, kind: node.kind, name: node.name, col: node.col, row: node.row }));
  const presence = others.map((name) => `${name} is also editing this draft`);

  return (
    <div ref={pageRef} className="editor">
      <header className="editor-head">
        <div className="editor-title">
          <h1>{draft.name}</h1>
          <div role="group" aria-label="Version drain" className="drain" data-live-version={liveVersion ?? ''} data-drain-count={draft.drain_count}>
            <Numeral version={liveVersion} />
            <span className="drain-count tabular">{`Runs left on older versions: ${draft.drain_count}`}</span>
          </div>
        </div>
        <div className="editor-actions">
          <Button variant="secondary" busy={busy === 'test'} {...lock} onClick={() => void startRun(true)}>
            Test run
          </Button>
          {draft.trigger_kind === 'manual' ? (
            <>
              <label className="run-input">
                <span className="sr-only">Run input (JSON)</span>
                <input type="text" aria-label="Run input (JSON)" value={runInput} onChange={(event) => setRunInput(event.target.value)} {...lock} />
              </label>
              <Button variant="secondary" busy={busy === 'run'} {...lock} onClick={() => void startRun(false)}>
                Run now
              </Button>
            </>
          ) : null}
          <Button busy={busy === 'publish'} {...lock} onClick={() => void publish()}>
            Publish
          </Button>
          <Button variant="secondary" busy={busy === 'export'} {...exportLock} onClick={() => void exportLive()}>
            Export live version
          </Button>
          <span id="reason-export" className="sr-only">
            Publish a version first
          </span>
          <Link to={`/w/${ws}/runs?automation=${automationId}`} className="action-link">
            View runs
          </Link>
          {lastRun ? (
            <Link to={`/w/${ws}/runs/${lastRun.id}`} className="action-link">
              {`View run #${lastRun.number}`}
            </Link>
          ) : null}
        </div>
      </header>
      <div role="status" aria-label="Draft notices" className="draft-notices">
        {presence.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {notice === '' ? null : <p>{notice}</p>}
      </div>
      {wide ? (
        <div className="editor-stage">
          <div role="toolbar" aria-label="Step kinds" className="toolbar">
            {TOOLBAR.map((tool) => (
              <button
                key={tool.kind}
                type="button"
                className="btn btn-secondary tool"
                aria-label={`Add step: ${tool.label}`}
                {...lock}
                onPointerDown={(event) => onToolPointerDown(event, tool.kind)}
                onClick={() => {
                  if (suppressClick.current) suppressClick.current = false;
                  else void addAt(tool.kind, cursor.col, cursor.row);
                }}
              >
                <KindIcon kind={tool.kind} size={18} />
                <span aria-hidden="true">{tool.label}</span>
              </button>
            ))}
          </div>
          <Canvas
            mode="edit"
            nodes={nodes}
            edges={draft.edges}
            ghosts={ghosts}
            tokens={tokens}
            liveVersion={liveVersion}
            animating={animating}
            onEdgeAnimationEnd={(id) =>
              setAnimating((current) => {
                const next = new Set(current);
                next.delete(id);
                return next;
              })
            }
            cursor={cursor}
            candidate={drawing?.target ?? null}
            drawingFrom={drawing?.from ?? null}
            moving={moving}
            preview={preview}
            regionRef={regionRef}
            worldRef={worldRef}
            onKeyDown={onKeyDown}
            onNodePointerDown={onNodePointerDown}
            onNodeClick={onNodeClick}
            onPortPointerDown={onPortPointerDown}
          />
        </div>
      ) : (
        <StepList items={items} onOpen={(item, element) => openDialog(item.id, element)} />
      )}
      {toolGhost ? (
        <div className="tool-ghost" aria-hidden="true" style={{ left: toolGhost.x, top: toolGhost.y }}>
          <KindIcon kind={toolGhost.kind} size={24} />
        </div>
      ) : null}
      {dialog && dialogNode ? (
        <SettingsDialog
          node={dialogNode}
          draft={draft}
          tables={tables}
          canEdit={access.canWrite}
          returnTo={dialog.opener}
          onSave={(change) => saveStep(dialogNode.id, change)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
