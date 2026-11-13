// The editor state hub. EditorProvider owns one EditorStore per open drawing; useEditor() is what panels and dialogs read.
// Everything that talks to the drawing API goes through here: runCommand is the only place that POSTs a base edit.
import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CommandName } from '../../shared/commands.ts';
import { COPY } from '../../shared/copy.ts';
import { drawingExtents, visibleLayerNames } from '../../shared/geometry.ts';
import type {
  Access, ApiObject, CommandSuccess, DrawingEvent, DrawingView, LinkInfo, MeResponse, Point, TraceSummary, TraceView, Units,
} from '../../shared/types.ts';
import { ApiError, get, post, useLinkToken } from '../api.ts';
import type { LinkEndState } from '../pages/LinkEnded.tsx';
import { announce } from '../ui/announce.tsx';
import { Camera } from './canvas/camera.ts';
import { Observable } from './observable.ts';
import { startSync } from './sync.ts';
import { initialMachine, promptOf, type InsertPresets, type MachineState } from './commandLine/machine.ts';
import { describeError, Session } from './commandLine/session.ts';

export const PANELS = [
  { id: 'properties', name: 'Properties', label: 'Prop.' },
  { id: 'layers', name: 'Layers', label: 'Layers' },
  { id: 'blocks', name: 'Blocks', label: 'Blocks' },
  { id: 'xrefs', name: 'Xrefs', label: 'Xrefs' },
  { id: 'traces', name: 'Traces', label: 'Traces' },
  { id: 'activity', name: 'Activity', label: 'Activity' },
  { id: 'issues', name: 'Issues', label: 'Issues' },
] as const;
export type PanelId = (typeof PANELS)[number]['id'];

export interface Aids { osnap: boolean; ortho: boolean; polar: boolean; grid: boolean; otrack: boolean }
export const AID_LABELS: Record<keyof Aids, { button: string; history: string }> = {
  osnap: { button: 'OSNAP', history: 'Osnap' },
  ortho: { button: 'ORTHO', history: 'Ortho' },
  polar: { button: 'POLAR', history: 'Polar' },
  grid: { button: 'SNAP & GRID', history: 'Snap' },
  otrack: { button: 'OTRACK', history: 'Otrack' },
};
const AIDS_KEY = 'corbel.aids';
const DEFAULT_AIDS: Aids = { osnap: true, ortho: false, polar: false, grid: false, otrack: false };

export const PHONE_QUERY = '(max-width: 599px)';
export const DESKTOP_QUERY = '(min-width: 1024px)';

export interface HistoryLine { id: number; text: string }
export interface Collaborator { name: string; state: 'Editing' | 'Viewing' | 'Away' }
export type EditorDialog = 'export' | 'share' | 'saveas' | 'reference';
export type Sheet = 'tools' | 'panels';
type DrawingEventName = DrawingEvent['event'];
type EventData<E extends DrawingEventName> = Extract<DrawingEvent, { event: E }>['data'];

const HISTORY_LIMIT = 300;
/** Codes the drawing can fail to open with, mapped to their copy in this one place. */
const OPEN_ERRORS: Record<string, string> = {
  not_found: 'This drawing was not found.',
  unauthenticated: 'Sign in to open this drawing.',
};
const OPEN_ERROR_FALLBACK = 'This drawing could not be opened.';

export interface EditorState {
  drawing: DrawingView | null;
  openError: string | null;
  linkInfo: LinkInfo | null;
  me: MeResponse | null;
  trial: { days_left: number; ended: boolean } | null;
  selection: string[];
  preview: Record<string, ApiObject> | null;
  activeTrace: TraceView | null;
  playback: TraceView | null;
  playbackKey: number;
  activePanel: PanelId | null;
  focusRequest: { panel: PanelId; n: number } | null;
  sheet: Sheet | null;
  layout: string;
  aids: Aids;
  history: HistoryLine[];
  machine: MachineState;
  busy: number;
  paused: boolean;
  /** The event stream has sent its first sync state: until then a change could land unseen, so the tab is not yet synced. */
  live: boolean;
  storageDown: boolean;
  conflict: { changed: number; version: number } | null;
  /** The version the server last reported, shown in `Conflict · v<n>`. */
  reportedVersion: number | null;
  collaborators: Collaborator[];
  highlight: { handles: string[]; key: number } | null;
  dialog: EditorDialog | null;
}

/** What useEditor() returns. */
interface Editor {
  drawing: DrawingView | null;
  units: Units;
  access: Access;
  isOwner: boolean;
  /** True when the base drawing may be edited: edit or owner access and the trial has not ended. */
  canEditBase: boolean;
  trialEnded: boolean;
  /** Handles of the selected objects, and the objects themselves (base objects, or the active trace's own objects). */
  selection: string[];
  selected: ApiObject[];
  /** Objects being dragged or edited, by handle, with their derived values computed from the pointer. */
  preview: Record<string, ApiObject> | null;
  setPreview: (preview: Record<string, ApiObject> | null) => void;
  /** The person's own open trace being edited, and the submitted trace being played back. */
  activeTrace: TraceView | null;
  playback: TraceView | null;
  activePanel: PanelId | null;
  setActivePanel: (panel: PanelId | null) => void;
  layout: string;
  history: HistoryLine[];
  prompt: string;
  syncLabel: string;
  trial: { days_left: number; ended: boolean } | null;
  collaborators: Collaborator[];
  linkInfo: LinkInfo | null;
  /**
   * POSTs a base edit on the current version. Resolves with the server's answer, or null when the edit was refused or
   * hit a version conflict (the reason is already in the history or the conflict dialog). A 422 or any other API
   * error is thrown as ApiError so the caller can show its field errors.
   */
  runCommand: (command: string, args: Record<string, unknown>) => Promise<CommandSuccess | null>;
  select: (handles: string[]) => void;
  startCommand: (name: CommandName, presets?: InsertPresets) => void;
  focusCommandLine: () => void;
  pushHistory: (line: string) => void;
  announce: (text: string) => void;
  /** Server events other than the ones the store consumes itself: traces, issues, activity, presence, link, trial, sync. */
  subscribe: <E extends DrawingEventName>(event: E, handler: (data: EventData<E>) => void) => () => void;
  reload: () => Promise<void>;
  activateTrace: (id: string | null) => Promise<void>;
  playTrace: (id: string) => Promise<void>;
  setLayout: (name: string) => void;
  openDialog: (dialog: EditorDialog) => void;
  closeDialog: () => void;
}

interface StoreOptions {
  drawingId?: string;
  linkToken?: string;
  onLinkEnded?: (state: LinkEndState) => void;
}

const storedAids = (): Aids => {
  try {
    const raw = sessionStorage.getItem(AIDS_KEY);
    return raw ? { ...DEFAULT_AIDS, ...(JSON.parse(raw) as Partial<Aids>) } : DEFAULT_AIDS;
  } catch {
    return DEFAULT_AIDS;
  }
};

const isPhone = (): boolean => matchMedia(PHONE_QUERY).matches;

export class EditorStore {
  readonly tabId = crypto.randomUUID();
  readonly camera = new Camera();
  readonly paperCamera = new Camera({ minX: 0, minY: 0, maxX: 420, maxY: 297 });
  /** Pointer position in the canvas, the snap in force and the last tapped point; changes far faster than the state. */
  readonly hud = new Observable<Hud>({ pointer: null, readout: null, cleared: false, cycle: 0, track: null });
  commandInput: HTMLInputElement | null = null;

  private state: EditorState;
  private snapshot: Editor;
  private readonly listeners = new Set<() => void>();
  private readonly handlers = new Map<DrawingEventName, Set<(data: never) => void>>();
  private queue: Promise<unknown> = Promise.resolve();
  /** The newest drawing version this tab has seen come from its own edits or has highlighted. */
  private known = 0;
  private stopSync: (() => void) | null = null;
  private highlightKey = 0;
  private focusKey = 0;
  private lineId = 0;
  readonly session: Session;
  /** The Editor's functions are created once, so panels can list them in effect dependencies. */
  private readonly actions: Pick<Editor, 'setPreview' | 'setActivePanel' | 'runCommand' | 'select' | 'startCommand' | 'focusCommandLine'
    | 'pushHistory' | 'announce' | 'subscribe' | 'reload' | 'activateTrace' | 'playTrace' | 'setLayout' | 'openDialog' | 'closeDialog'> = {
    setPreview: (preview) => this.setState({ preview }),
    setActivePanel: (panel) => this.setActivePanel(panel),
    runCommand: (command, args) => this.runCommand(command, args),
    select: (handles) => this.select(handles),
    startCommand: (name, presets) => this.session.start(name, presets),
    focusCommandLine: () => this.focusCommandLine(),
    pushHistory: (line) => this.pushHistory(line),
    announce,
    subscribe: (event, handler) => this.subscribe(event, handler),
    reload: () => this.reload(),
    activateTrace: (id) => this.activateTrace(id),
    playTrace: (id) => this.playTrace(id),
    setLayout: (name) => this.setLayout(name),
    openDialog: (dialog) => this.setState({ dialog }),
    closeDialog: () => this.setState({ dialog: null }),
  };

  constructor(private readonly options: StoreOptions) {
    useLinkToken(options.linkToken ?? null);
    this.state = {
      drawing: null, openError: null, linkInfo: null, me: null, trial: null, selection: [], preview: null, activeTrace: null,
      playback: null, playbackKey: 0, activePanel: matchMedia(DESKTOP_QUERY).matches || isPhone() ? 'properties' : null,
      focusRequest: null, sheet: null, layout: 'Model', aids: storedAids(), history: [], machine: initialMachine, busy: 0,
      paused: false, live: false, storageDown: false, conflict: null, reportedVersion: null, collaborators: [], highlight: null, dialog: null,
    };
    this.session = new Session(this);
    this.snapshot = this.build();
  }

  // ---- React plumbing ----

  readonly listen = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): Editor => this.snapshot;

  get current(): EditorState {
    return this.state;
  }

  setState(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    this.snapshot = this.build();
    for (const listener of [...this.listeners]) listener();
  }

  private build(): Editor {
    const { drawing, selection, activeTrace, machine, busy, paused, live, conflict } = this.state;
    const access = drawing?.access ?? 'view';
    const trialEnded = this.state.trial?.ended ?? false;
    const pool = [...(drawing?.objects ?? []), ...(activeTrace?.objects ?? [])];
    return {
      drawing,
      units: drawing?.units ?? 'mm',
      access,
      isOwner: access === 'owner',
      canEditBase: (access === 'owner' || access === 'edit') && !trialEnded,
      trialEnded,
      selection,
      selected: selection.flatMap((handle) => pool.find((object) => object.handle === handle) ?? []),
      preview: this.state.preview,
      ...this.actions,
      activeTrace,
      playback: this.state.playback,
      activePanel: this.state.activePanel,
      layout: this.state.layout,
      history: this.state.history,
      prompt: promptOf(machine),
      syncLabel: this.state.openError ? '' : !drawing || !live || busy > 0 ? 'Syncing…'
        : conflict ? `Conflict · v${this.state.reportedVersion ?? drawing.version}`
          : paused ? 'Live sync paused' : `Synced · v${drawing.version}`,
      trial: this.state.trial,
      collaborators: this.state.collaborators,
      linkInfo: this.state.linkInfo,
    };
  }

  // ---- Lifecycle ----

  start(): void {
    if (this.stopSync) return;
    void this.open();
  }

  stop(): void {
    this.stopSync?.();
    this.stopSync = null;
  }

  private async open(): Promise<void> {
    const { drawingId, linkToken } = this.options;
    try {
      let id = drawingId ?? '';
      if (linkToken) {
        const info = await get<LinkInfo>(`/api/links/${encodeURIComponent(linkToken)}`);
        this.setState({ linkInfo: info });
        id = info.drawing.id;
      }
      const drawing = await get<DrawingView>(`/api/drawings/${id}`);
      this.known = drawing.version;
      this.applyDrawing(drawing);
      this.fitView();
      this.stopSync = startSync({
        drawingId: id,
        tabId: this.tabId,
        onEvent: (event) => this.handleEvent(event),
        onReconnect: () => this.refresh(),
      });
      if (!linkToken) {
        const me = await get<MeResponse>('/api/me');
        this.setState({ me, trial: me.trial });
        await post(`/api/drawings/${id}/opened`).catch(() => undefined);
      }
    } catch (error) {
      this.openFailed(error);
    }
  }

  linkEnded(state: LinkEndState): void {
    this.options.onLinkEnded?.(state);
  }

  private openFailed(error: unknown): void {
    const code = error instanceof ApiError ? error.code : undefined;
    if (code === 'link_expired') this.options.onLinkEnded?.('expired');
    else if (code === 'link_revoked') this.options.onLinkEnded?.('revoked');
    else if (this.options.linkToken && code === 'not_found') this.options.onLinkEnded?.('invalid');
    else this.setState({ openError: (code && OPEN_ERRORS[code]) || OPEN_ERROR_FALLBACK });
  }

  // ---- Drawing state ----

  private get drawingId(): string | null {
    return this.state.drawing?.id ?? null;
  }

  private applyDrawing(drawing: DrawingView): void {
    const visible = visibleLayerNames(drawing.layers);
    const selectable = new Set(drawing.objects.filter((object) => visible.has(object.layer)).map((object) => object.handle));
    const traceHandles = new Set(this.state.activeTrace?.objects.map((object) => object.handle));
    const selection = this.state.selection.filter((handle) => selectable.has(handle) || traceHandles.has(handle));
    this.setState({ drawing, selection: selection.length === this.state.selection.length ? this.state.selection : selection });
  }

  /** The view fits when the drawing first opens and on ZOOM E, never on edits or remote changes. */
  fitView(): void {
    const drawing = this.state.drawing;
    if (!drawing) return;
    this.camera.fitTo(drawingExtents(drawing.objects, drawing.layers));
  }

  /** Opened through a share link rather than a signed-in session. */
  get isLinkHolder(): boolean {
    return Boolean(this.options.linkToken);
  }

  private async fetchDrawing(): Promise<void> {
    const id = this.drawingId;
    if (!id) return;
    this.applyDrawing(await get<DrawingView>(`/api/drawings/${id}`));
  }

  /** Reloads the drawing now (Load latest); whatever it holds counts as seen, so nothing highlights. */
  async reload(): Promise<void> {
    await this.enqueue(async () => {
      await this.fetchDrawing();
      this.known = Math.max(this.known, this.state.drawing?.version ?? 0);
      this.setState({ conflict: null, reportedVersion: null });
    });
  }

  /** Brings the drawing up to date in the background; a failed fetch leaves the state as it was. */
  private refetch(): void {
    this.enqueue(() => this.fetchDrawing()).catch(() => undefined);
  }

  /** Reloads in the background after a sync gap: whatever the drawing holds counts as seen, so nothing highlights. */
  private refresh(): void {
    this.reload().catch(() => undefined);
  }

  /** Own edits and server events run one at a time, so a remote change is compared with the version after our own edit. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async runCommand(command: string, args: Record<string, unknown>): Promise<CommandSuccess | null> {
    const result = await this.enqueue(async () => {
      const drawing = this.state.drawing;
      if (!drawing) return null;
      this.setState({ busy: this.state.busy + 1 });
      try {
        const success = await post<CommandSuccess>(`/api/drawings/${drawing.id}/commands`, { base_version: drawing.version, command, args });
        this.known = Math.max(this.known, success.version);
        this.patchDrawing(success);
        if (success.history) this.pushHistory(success.history);
        return success;
      } catch (error) {
        return this.refused(error);
      } finally {
        this.setState({ busy: this.state.busy - 1 });
      }
    });
    if (result) this.refetch();
    return result;
  }

  /** Access and conflict refusals become history lines or the conflict dialog; anything else the caller must show. */
  private refused(error: unknown): null {
    if (!(error instanceof ApiError)) throw error;
    switch (error.code) {
      case 'version_conflict': {
        const changed = Array.isArray(error.body.changed) ? error.body.changed.length : 0;
        const version = typeof error.body.current_version === 'number' ? error.body.current_version : this.state.drawing?.version ?? 0;
        this.setState({ conflict: { changed, version }, reportedVersion: version });
        return null;
      }
      case 'view_only': this.pushHistory(COPY.viewOnly); return null;
      case 'markup_only': this.pushHistory(COPY.markupOnly); return null;
      case 'trial_ended':
        this.setState({ trial: { days_left: 0, ended: true } });
        this.pushHistory(COPY.trialEnded);
        return null;
      case 'link_expired': this.linkEnded('expired'); return null;
      case 'link_revoked': this.linkEnded('revoked'); return null;
      default: throw error;
    }
  }

  /** Puts the answer's objects into the drawing at once; the follow-up fetch brings counts, intersections and layers. */
  private patchDrawing(success: CommandSuccess): void {
    const drawing = this.state.drawing;
    if (!drawing) return;
    const changed = new Map(success.objects.map((object) => [object.handle, object]));
    const erased = new Set(success.erased);
    const kept = drawing.objects.filter((object) => !erased.has(object.handle)).map((object) => changed.get(object.handle) ?? object);
    const added = success.objects.filter((object) => !drawing.objects.some((existing) => existing.handle === object.handle));
    this.applyDrawing({ ...drawing, version: success.version, objects: [...kept, ...added] });
  }

  async runTraceCommand(command: string, args: Record<string, unknown>): Promise<void> {
    const trace = this.state.activeTrace;
    if (!trace) return;
    this.setState({ busy: this.state.busy + 1 });
    try {
      const answer = await post<{ trace: TraceView }>(`/api/traces/${trace.id}/commands`, { command, args });
      this.setState({ activeTrace: answer.trace, selection: [] });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === 'trace_not_open') this.setState({ activeTrace: null });
      for (const line of describeError(error)) this.pushHistory(line);
    } finally {
      this.setState({ busy: this.state.busy - 1 });
    }
  }

  // ---- Server events ----

  private handleEvent(event: DrawingEvent): void {
    switch (event.event) {
      case 'change': this.remoteChange(event.data); break;
      case 'presence': this.setState({ collaborators: event.data.collaborators }); break;
      case 'link':
        if (event.data.status !== 'active') this.options.onLinkEnded?.(event.data.status);
        break;
      case 'trace': this.traceChanged(event.data.trace); break;
      case 'trial': {
        const ended = event.data.ended && !this.state.trial?.ended;
        this.setState({ trial: event.data });
        if (ended) announce(COPY.trialEnded);
        break;
      }
      case 'sync': this.syncChanged(event.data); break;
      case 'issues': case 'activity': break;
    }
    const set = this.handlers.get(event.event);
    if (set) for (const handler of set) (handler as (data: unknown) => void)(event.data);
  }

  private remoteChange(change: EventData<'change'>): void {
    this.enqueue(async () => {
      if (change.version <= this.known) return;
      this.known = change.version;
      await this.fetchDrawing();
      const present = new Set(this.state.drawing?.objects.map((object) => object.handle));
      const handles = change.changed.filter((handle) => present.has(handle));
      this.setState({ highlight: handles.length > 0 ? { handles, key: ++this.highlightKey } : null });
    }).catch(() => undefined);
  }

  private traceChanged(trace: TraceSummary): void {
    const drawing = this.state.drawing;
    if (!drawing) return;
    const before = drawing.traces.find((item) => item.id === trace.id);
    const traces = before ? drawing.traces.map((item) => (item.id === trace.id ? trace : item)) : [...drawing.traces, trace];
    const active = this.state.activeTrace;
    this.setState({
      drawing: { ...drawing, traces },
      activeTrace: active && active.id === trace.id && trace.state !== 'open' ? null : active,
    });
    if (drawing.access === 'owner' && trace.state === 'submitted' && before?.state !== 'submitted') {
      announce(`Trace "${trace.name}" submitted by ${trace.author}`);
    }
  }

  private syncChanged(sync: EventData<'sync'>): void {
    const { paused, storageDown } = this.state;
    const resumed = paused && sync.state === 'live';
    this.setState({ paused: sync.state === 'paused', live: true, storageDown: sync.storage === 'down' });
    if (sync.state === 'paused' && !paused) announce(COPY.bannerValkey);
    if (sync.storage === 'down' && !storageDown) announce(COPY.bannerMinio);
    if (resumed) this.refresh();
  }

  private subscribe<E extends DrawingEventName>(event: E, handler: (data: EventData<E>) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (data: never) => void);
    this.handlers.set(event, set);
    return () => set.delete(handler as (data: never) => void);
  }

  // ---- Traces ----

  async activateTrace(id: string | null): Promise<void> {
    if (id === null) {
      this.setState({ activeTrace: null });
      return;
    }
    const { trace } = await get<{ trace: TraceView }>(`/api/traces/${id}`);
    this.setState({ activeTrace: trace, playback: null, selection: [] });
  }

  async playTrace(id: string): Promise<void> {
    const { trace } = await get<{ trace: TraceView }>(`/api/traces/${id}`);
    this.setState({ playback: trace, playbackKey: this.state.playbackKey + 1, activeTrace: null, selection: [] });
  }

  endPlayback(): void {
    this.setState({ playback: null });
  }

  // ---- Selection, aids, panels, layouts ----

  select(handles: string[]): void {
    this.setState({ selection: [...new Set(handles)] });
  }

  toggleAid(name: keyof Aids): void {
    const was = this.state.aids;
    const on = !was[name];
    const aids: Aids = { ...was, [name]: on, ...(on && name === 'ortho' ? { polar: false } : {}), ...(on && name === 'polar' ? { ortho: false } : {}) };
    sessionStorage.setItem(AIDS_KEY, JSON.stringify(aids));
    this.setState({ aids });
    this.hud.update({ cycle: 0 });
    this.pushHistory(`<${AID_LABELS[name].history} ${on ? 'on' : 'off'}>`);
  }

  setActivePanel(panel: PanelId | null): void {
    this.setState({ activePanel: panel, sheet: panel && isPhone() ? 'panels' : this.state.sheet });
  }

  /** Opens a panel and, once it has rendered, moves focus into it (LA and I). */
  showPanel(panel: PanelId): void {
    this.setActivePanel(panel);
    this.setState({ focusRequest: { panel, n: ++this.focusKey } });
  }

  setSheet(sheet: Sheet | null): void {
    this.setState({ sheet });
  }

  /** Starting a command clears the way to the canvas: a tablet's overlay panel closes, a phone's sheet closes. */
  clearWayToCanvas(): void {
    const overlay = !matchMedia(DESKTOP_QUERY).matches && !isPhone();
    this.setState({ sheet: null, ...(overlay ? { activePanel: null } : {}) });
  }

  setLayout(name: string): void {
    this.setState({ layout: name });
    this.hud.update({ cycle: 0 });
  }

  focusCommandLine(): void {
    this.commandInput?.focus();
  }

  pushHistory(text: string): void {
    const history = [...this.state.history, { id: ++this.lineId, text }].slice(-HISTORY_LIMIT);
    this.setState({ history });
  }

  setMachine(machine: MachineState): void {
    this.setState({ machine });
  }

}

interface Hud {
  /** In canvas pixels. */
  pointer: { x: number; y: number; touch: boolean } | null;
  /** What the coordinates readout shows when no pointer is over the canvas: the last tapped point, or where the pointer left. */
  readout: Point | null;
  /** True after a pick until the pointer moves again: the snap marker stays away. */
  cleared: boolean;
  /** Which of the candidates in the aperture Tab has cycled to. */
  cycle: number;
  /** The last snap point picked: OTRACK draws its alignment paths through it. */
  track: Point | null;
}

// ---- React bindings ----

const Context = createContext<EditorStore | null>(null);

interface ProviderProps extends StoreOptions { children: ReactNode }

export function EditorProvider({ drawingId, linkToken, onLinkEnded, children }: ProviderProps) {
  const [store] = useState(() => new EditorStore({ drawingId, linkToken, onLinkEnded }));
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return createElement(Context.Provider, { value: store }, children);
}

/** The store itself, for the shell and canvas, which need more than the panels' Editor view. */
export function useEditorStore(): EditorStore {
  const store = useContext(Context);
  if (!store) throw new Error('useEditor needs an EditorProvider');
  return store;
}

export function useEditor(): Editor {
  const store = useEditorStore();
  return useSyncExternalStore(store.listen, store.getSnapshot);
}

/** The full state for the shell (open error, banners, sheets, machine). */
export function useEditorState(): EditorState {
  const store = useEditorStore();
  return useSyncExternalStore(store.listen, () => store.current);
}
