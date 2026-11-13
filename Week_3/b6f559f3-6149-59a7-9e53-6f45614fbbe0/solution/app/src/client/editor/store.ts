/**
 * The editor's state and its server sync, outside React.
 *
 * `confirmed` is the document as the server last told us; `view` is `confirmed` with every step not yet
 * acknowledged applied on top, which is what the screen and the readouts show. Steps are sent one `ops`
 * request each, in order, AUTOSAVE_MS after the last change; a retry resends the same opId.
 */
import {
  applyChanges,
  applyPatch,
  changeLayerIds,
  findLayer,
  lockRefusal,
  type DocumentContext,
  type Patch,
} from '../../shared/document';
import { framesIn, timeReadout } from '../../shared/format';
import {
  MESSAGES,
  keyframeAdded,
  uploadReady,
  uploading,
} from '../../shared/messages';
import { findLayerDefinition } from '../../shared/properties';
import { WS_PATH, type OpsResponse, type Person, type ProjectResponse, type ServerMessage, type SessionUser, type UndoResponse } from '../../shared/protocol';
import { contextOf } from '../../shared/evaluator';
import { resolveLayer } from '../../shared/evaluator/resolve';
import type {
  AssetInfo,
  Breakpoint,
  Change,
  Easing,
  LockInfo,
  ProjectSummary,
  Role,
  Scene,
  SceneDocument,
  VariableValue,
} from '../../shared/types';
import { api, ApiError, newId, publicSettings } from '../api';
import { navigate } from '../router';
import { CAMERA_ID, type Editor, type EditorActions, type EditorState, type NoticePanel } from './model';

const RETRY_MS = 1000;
const RECONNECT_MS = 1000;
const LOCAL_SEEDS = { particle: 0, cloth: 0, grain: 0 };
const CREATING: readonly Change['type'][] = ['addLayer', 'duplicateLayer', 'group'];

type OpsItem = {
  kind: 'ops';
  opId: string;
  sceneId: string;
  changes: Change[];
  mergeKey: string | undefined;
  panel: NoticePanel;
  /** Applied to the view while waiting. Creating steps wait for the server's ids instead. */
  replay: boolean;
  ready: boolean;
  sent: boolean;
  done?: (ids: Record<string, string> | null) => void;
};
type HistoryItem = { kind: 'undo' | 'redo'; opId: string };
type UnlockItem = { kind: 'unlock'; layerId: string };
type Item = OpsItem | HistoryItem | UnlockItem;

type Snapshot = Editor;

function mergeKeyOf(changes: readonly Change[]): string | undefined {
  const only = changes.length === 1 ? changes[0] : undefined;
  if (!only) return undefined;
  switch (only.type) {
    case 'updateLayer': {
      const keys = Object.keys(only.set);
      return keys.length === 1 ? `layer|${only.layerId}|${only.breakpoint}|${keys[0]}` : undefined;
    }
    case 'updateScene': {
      const keys = Object.keys(only.set);
      return keys.length === 1 ? `scene|${only.breakpoint}|${keys[0]}` : undefined;
    }
    case 'updateVariable':
      return `variable|${only.name}`;
    case 'moveKeyframe':
      return `keyframe|${only.layerId}|${only.property}`;
    default:
      return undefined;
  }
}

/** Folds `incoming` into the changes of a step that is still waiting to be sent. */
function mergeChanges(into: Change[], incoming: readonly Change[]): void {
  for (const change of incoming) {
    const last = into[into.length - 1];
    if (last && last.type === 'updateLayer' && change.type === 'updateLayer' && last.layerId === change.layerId && last.breakpoint === change.breakpoint) {
      last.set = { ...last.set, ...change.set };
    } else if (last && last.type === 'updateScene' && change.type === 'updateScene' && last.breakpoint === change.breakpoint) {
      last.set = { ...last.set, ...change.set };
    } else if (last && last.type === 'updateVariable' && change.type === 'updateVariable' && last.name === change.name) {
      last.value = change.value;
    } else if (
      last &&
      last.type === 'moveKeyframe' &&
      change.type === 'moveKeyframe' &&
      last.layerId === change.layerId &&
      last.property === change.property &&
      last.toFrame === change.fromFrame
    ) {
      last.toFrame = change.toFrame;
    } else if (
      last &&
      last.type === 'setKeyframe' &&
      change.type === 'setKeyframe' &&
      last.layerId === change.layerId &&
      last.property === change.property &&
      last.frame === change.frame
    ) {
      into[into.length - 1] = change;
    } else {
      into.push(change);
    }
  }
}

interface Fields {
  project: ProjectSummary;
  sceneId: string;
  breakpoint: Breakpoint;
  frame: number;
  playing: boolean;
  preview: boolean;
  reduceMotion: boolean;
  scroll: number;
  selection: readonly string[];
  primary: string | null;
  focusedProperty: string | null;
  focusedKeyframe: EditorState['focusedKeyframe'];
  locks: ReadonlyMap<string, LockInfo>;
  people: readonly Person[];
  notices: Readonly<Partial<Record<NoticePanel, string>>>;
  saveStatus: EditorState['saveStatus'];
  announcement: string;
  connection: 'up' | 'down';
  undoDepth: number;
  redoDepth: number;
  versionTick: number;
  membersTick: number;
}

export class EditorStore {
  private readonly settings = publicSettings();
  private readonly listeners = new Set<() => void>();
  private confirmed: SceneDocument;
  private view: SceneDocument;
  private assets: Map<string, AssetInfo>;
  private fields: Fields;
  private snapshot!: Snapshot;
  private items: Item[] = [];
  private pumping = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastSeq: number;
  private mine = new Set<string>();
  private socket: WebSocket | undefined;
  private socketTimer: ReturnType<typeof setTimeout> | undefined;
  private lostOnce = false;
  private disposed = false;
  private frameHandle = 0;
  private playedAt = 0;
  private resyncing: Promise<void> | undefined;

  constructor(
    private readonly projectId: string,
    private readonly me: SessionUser,
    response: ProjectResponse,
  ) {
    this.confirmed = response.document;
    this.view = response.document;
    this.assets = new Map(response.assets.map((asset) => [asset.id, asset]));
    this.lastSeq = response.seq;
    this.fields = {
      project: response.project,
      sceneId: response.document.scenes[0]?.id ?? '',
      breakpoint: 'desktop',
      frame: 0,
      playing: false,
      preview: false,
      reduceMotion: false,
      scroll: 0,
      selection: [],
      primary: null,
      focusedProperty: null,
      focusedKeyframe: null,
      locks: new Map(response.locks.map((lock) => [lock.layerId, lock])),
      people: [],
      notices: {},
      saveStatus: 'saved',
      announcement: '',
      connection: 'up',
      undoDepth: response.undoDepth,
      redoDepth: response.redoDepth,
      versionTick: 0,
      membersTick: 0,
    };
    this.commit();
    this.connect();
  }

  // ------------------------------------------------------------ subscription

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private set(patch: Partial<Fields>): void {
    this.fields = { ...this.fields, ...patch };
    this.commit();
  }

  private commit(): void {
    const f = this.fields;
    const scene = this.view.scenes.find((s) => s.id === f.sceneId) ?? (this.view.scenes[0] as Scene);
    const role: Role = f.project.role;
    this.snapshot = {
      projectId: this.projectId,
      project: f.project,
      me: this.me,
      role,
      canEdit: role !== 'Viewer',
      document: this.view,
      scene,
      assets: this.assets,
      breakpoint: f.breakpoint,
      frame: f.frame,
      playing: f.playing,
      preview: f.preview,
      reduceMotion: f.reduceMotion,
      scroll: f.scroll,
      selection: f.selection,
      primary: f.primary,
      focusedProperty: f.focusedProperty,
      focusedKeyframe: f.focusedKeyframe,
      locks: f.locks,
      people: f.people,
      heldByOther: (layerId) => {
        const lock = f.locks.get(layerId);
        return lock && lock.heldBy.id !== this.me.id ? lock.heldBy : null;
      },
      notices: f.notices,
      sceneId: f.sceneId,
      saveStatus: f.saveStatus,
      statusText: f.connection === 'down' ? MESSAGES.connectionLost : f.announcement,
      connection: f.connection,
      undoDepth: f.undoDepth,
      redoDepth: f.redoDepth,
      versionTick: f.versionTick,
      membersTick: f.membersTick,
      ...this.actions,
    };
    this.listeners.forEach((listener) => listener());
  }

  // ------------------------------------------------------------ documents

  private context(): DocumentContext {
    return { seeds: LOCAL_SEEDS, newId, assetStatus: (id) => this.assets.get(id)?.status };
  }

  /** The view: confirmed state with every waiting step on top. */
  private rebase(): void {
    let doc = this.confirmed;
    for (const item of this.items) {
      if (item.kind !== 'ops' || !item.replay) continue;
      const outcome = applyChanges(doc, item.sceneId, item.changes, this.context());
      if (outcome.ok) doc = outcome.document;
    }
    this.view = doc;
    const ids = new Set(doc.scenes.flatMap((scene) => scene.layers.map((l) => l.id)));
    const selection = this.fields.selection.filter((id) => id === CAMERA_ID || ids.has(id));
    if (selection.length !== this.fields.selection.length) {
      this.fields = { ...this.fields, selection, primary: selection.includes(this.fields.primary ?? '') ? this.fields.primary : (selection[selection.length - 1] ?? null) };
    }
    if (!doc.scenes.some((s) => s.id === this.fields.sceneId)) this.fields = { ...this.fields, sceneId: doc.scenes[0]?.id ?? '' };
  }

  private applyServerPatch(seq: number, patch: Patch): void {
    if (seq <= this.lastSeq) return;
    this.lastSeq = seq;
    const doc = structuredClone(this.confirmed);
    applyPatch(doc, patch);
    this.confirmed = doc;
    this.rebase();
    this.ensureAssets();
  }

  private ensureAssets(): void {
    const used = this.view.scenes.flatMap((scene) =>
      scene.layers.flatMap((layer) =>
        ['assetId', 'svgAssetId', 'modelAssetId'].flatMap((key) => {
          const value = layer.props[key];
          return typeof value === 'string' ? [value] : [];
        }),
      ),
    );
    if (used.some((id) => !this.assets.has(id))) void this.refresh();
  }

  refresh = (): Promise<void> => {
    this.resyncing ??= (async () => {
      try {
        const response = await api.get<ProjectResponse>(`/api/projects/${this.projectId}`);
        this.confirmed = response.document;
        this.assets = new Map(response.assets.map((asset) => [asset.id, asset]));
        this.lastSeq = response.seq;
        this.rebase();
        this.set({
          project: response.project,
          locks: new Map(response.locks.map((lock) => [lock.layerId, lock])),
          undoDepth: response.undoDepth,
          redoDepth: response.redoDepth,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) navigate('/signin', true);
      } finally {
        this.resyncing = undefined;
      }
    })();
    return this.resyncing;
  };

  // ------------------------------------------------------------ steps

  private saving(): EditorState['saveStatus'] {
    return this.items.some((item) => item.kind === 'ops') || this.timer !== undefined ? 'saving' : 'saved';
  }

  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.settings.autosaveMs);
  }

  /** Sends everything waiting, in order, now. */
  private flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const item of this.items) if (item.kind === 'ops') item.ready = true;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const item = this.items[0];
        if (!item || (item.kind === 'ops' && !item.ready)) break;
        const outcome = await this.run(item);
        if (outcome === 'retry') {
          this.set({ saveStatus: 'failed' });
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
          continue;
        }
        this.items.shift();
        this.rebase();
        this.set({ saveStatus: this.saving() });
      }
    } finally {
      this.pumping = false;
      this.set({ saveStatus: this.saving() });
    }
  }

  private async run(item: Item): Promise<'done' | 'retry'> {
    try {
      if (item.kind === 'unlock') {
        await api.delete(`/api/projects/${this.projectId}/layers/${item.layerId}/lock`).catch(() => undefined);
        this.mine.delete(item.layerId);
        return 'done';
      }
      if (item.kind === 'ops') {
        item.sent = true;
        this.set({ saveStatus: 'saving' });
        const response = await api.post<OpsResponse>(`/api/projects/${this.projectId}/ops`, {
          opId: item.opId,
          sceneId: item.sceneId,
          changes: item.changes,
        });
        this.applyServerPatch(response.seq, response.patch);
        this.lastSeq = Math.max(this.lastSeq, response.seq);
        this.set({ undoDepth: response.undoDepth, redoDepth: response.redoDepth });
        item.done?.(response.ids);
        return 'done';
      }
      const response = await api.post<UndoResponse>(`/api/projects/${this.projectId}/${item.kind}`, { opId: item.opId });
      this.applyServerPatch(response.seq, response.patch);
      this.lastSeq = Math.max(this.lastSeq, response.seq);
      this.set({
        undoDepth: response.undoDepth,
        redoDepth: response.redoDepth,
        announcement: item.kind === 'undo' ? MESSAGES.undone : MESSAGES.redone,
      });
      return 'done';
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 0 || error.status >= 500) return 'retry';
      if (error.status === 401) navigate('/signin', true);
      if (item.kind === 'ops') {
        item.replay = false;
        item.done?.(null);
        this.set({ notices: { ...this.fields.notices, [item.panel]: error.message } });
        await this.refresh();
      } else if (item.kind === 'undo' || item.kind === 'redo') {
        this.set({ announcement: error.message });
      }
      return 'done';
    }
  }

  // ------------------------------------------------------------ actions

  private notice(panel: NoticePanel, message: string | null): void {
    const notices = { ...this.fields.notices };
    if (message === null) delete notices[panel];
    else notices[panel] = message;
    this.set({ notices });
  }

  private enqueue(changes: Change[], mergeKey: string | undefined, panel: NoticePanel, done?: OpsItem['done']): boolean {
    const f = this.fields;
    if (this.snapshot.role === 'Viewer') {
      this.notice(panel, MESSAGES.viewerRefusal);
      done?.(null);
      return false;
    }
    const refusal = lockRefusal(this.view, changes, (id) => this.snapshot.heldByOther(id)?.name ?? null);
    if (refusal) {
      this.notice(panel, refusal.message);
      done?.(null);
      return false;
    }
    const creating = changes.some((change) => CREATING.includes(change.type));
    if (!creating) {
      const outcome = applyChanges(this.view, f.sceneId, changes, this.context());
      if (!outcome.ok) {
        this.notice(panel, outcome.refusal.message);
        done?.(null);
        return false;
      }
      this.view = outcome.document;
    }
    for (const id of changes.flatMap(changeLayerIds)) if (findLayer(this.confirmed, id)) this.mine.add(id);
    const key = mergeKey ?? mergeKeyOf(changes);
    const last = this.items[this.items.length - 1];
    if (!creating && key && last && last.kind === 'ops' && !last.sent && !last.ready && last.replay && last.mergeKey === key && last.sceneId === f.sceneId) {
      mergeChanges(last.changes, changes);
    } else {
      this.items.push({
        kind: 'ops',
        opId: newId(),
        sceneId: f.sceneId,
        changes: structuredClone(changes),
        mergeKey: creating ? undefined : key,
        panel,
        replay: !creating,
        ready: false,
        sent: false,
        done,
      });
    }
    const notices = { ...f.notices };
    delete notices[panel];
    this.fields = { ...this.fields, notices, saveStatus: 'saving' };
    this.commit();
    if (creating || !key) this.flush();
    else this.schedule();
    return true;
  }

  private selectInternal(ids: readonly string[], primary?: string | null): void {
    const next = [...ids];
    for (const id of this.mine) {
      if (!next.includes(id)) this.items.push({ kind: 'unlock', layerId: id });
    }
    if (this.items.some((item) => item.kind === 'unlock')) this.flush();
    const notices = { ...this.fields.notices };
    delete notices.inspector;
    this.set({ selection: next, primary: primary === undefined ? (next[next.length - 1] ?? null) : primary, notices });
  }

  private playLoop = (now: number): void => {
    if (!this.fields.playing || this.disposed) return;
    const last = framesIn(this.sceneNow().durationMs);
    const elapsed = now - this.playedAt;
    const advance = Math.floor((elapsed * 60) / 1000);
    if (advance > 0) {
      this.playedAt += (advance * 1000) / 60;
      const frame = Math.min(last, this.fields.frame + advance);
      if (frame >= last) this.set({ frame: last, playing: false });
      else this.set({ frame });
    }
    if (this.fields.playing) this.frameHandle = requestAnimationFrame(this.playLoop);
  };

  private sceneNow(): Scene {
    return this.snapshot.scene;
  }

  actions: EditorActions = {
    apply: (changes, mergeKey, panel = 'inspector') => {
      this.enqueue(changes, mergeKey, panel);
    },
    applyWithIds: (changes, panel = 'layers') =>
      new Promise((resolve) => {
        this.enqueue(changes, undefined, panel, resolve);
      }),
    editLayer: (layerId, set, mergeKey) => {
      this.actions.apply([{ type: 'updateLayer', layerId, set, breakpoint: this.fields.breakpoint }], mergeKey, 'inspector');
    },
    resetOverride: (layerId, path) => {
      this.actions.apply([{ type: 'clearOverride', layerId, breakpoint: this.fields.breakpoint, path }], undefined, 'inspector');
    },
    editScene: (set, mergeKey) => {
      this.actions.apply([{ type: 'updateScene', set, breakpoint: this.fields.breakpoint }], mergeKey, 'inspector');
    },
    setKeyframe: (layerId, property, frame, value, easing: Easing) => {
      this.actions.apply([{ type: 'setKeyframe', layerId, property, frame, value, easing }], undefined, 'timeline');
    },
    setVariable: (name, value: VariableValue) => {
      this.actions.apply([{ type: 'updateVariable', name, value }], undefined, 'variables');
    },
    select: (ids, primary) => this.selectInternal(ids, primary),
    setBreakpoint: (breakpoint) => this.set({ breakpoint }),
    setFrame: (frame) => {
      const last = framesIn(this.sceneNow().durationMs);
      this.set({ frame: Math.min(Math.max(Math.round(frame), 0), last) });
    },
    setPlaying: (playing) => {
      if (playing === this.fields.playing) return;
      if (playing) {
        const last = framesIn(this.sceneNow().durationMs);
        this.playedAt = performance.now();
        this.set({ playing: true, frame: this.fields.frame >= last ? 0 : this.fields.frame });
        this.frameHandle = requestAnimationFrame(this.playLoop);
      } else {
        cancelAnimationFrame(this.frameHandle);
        this.set({ playing: false });
      }
    },
    setPreview: (preview) => this.set({ preview }),
    setReduceMotion: (reduceMotion) => this.set({ reduceMotion }),
    setScroll: (scroll) => this.set({ scroll: Math.min(Math.max(Math.round(scroll), 0), 100) }),
    setFocusedProperty: (focusedProperty) => {
      if (focusedProperty !== this.fields.focusedProperty) this.set({ focusedProperty });
    },
    setFocusedKeyframe: (focusedKeyframe) => this.set({ focusedKeyframe }),
    announce: (announcement) => this.set({ announcement }),
    setNotice: (panel, message) => this.notice(panel, message),
    undo: () => {
      this.items.push({ kind: 'undo', opId: newId() });
      this.flush();
    },
    redo: () => {
      this.items.push({ kind: 'redo', opId: newId() });
      this.flush();
    },
    releaseLock: () => {
      for (const id of this.mine) this.items.push({ kind: 'unlock', layerId: id });
      if (this.items.some((item) => item.kind === 'unlock')) this.flush();
    },
    uploadAsset: async (kind, file) => {
      this.set({ announcement: uploading(file.name) });
      const form = new FormData();
      form.set('kind', kind);
      form.set('file', file);
      try {
        const { asset } = await api.upload<{ asset: AssetInfo }>(`/api/projects/${this.projectId}/assets`, form);
        await this.refresh();
        this.set({ announcement: uploadReady(file.name) });
        return this.assets.get(asset.id) ?? asset;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        this.set({ announcement: '' });
        this.notice('layers', error.errors['file'] ?? error.message);
        return null;
      }
    },
    addKeyframeAtPlayhead: () => {
      const f = this.fields;
      const layer = f.primary && f.primary !== CAMERA_ID ? findLayer(this.view, f.primary)?.layer : undefined;
      const def = layer && f.focusedProperty ? findLayerDefinition(layer, f.focusedProperty) : undefined;
      if (!layer || !def || !def.keyframeable || !f.focusedProperty) {
        this.notice('timeline', MESSAGES.chooseProperty);
        return;
      }
      const resolved = resolveLayer(layer, contextOf({ frame: f.frame, breakpoint: f.breakpoint, scroll: f.scroll, reducedMotion: false }, this.view.variables));
      const value = resolved.values[f.focusedProperty];
      const existing = layer.keyframes.find((k) => k.property === f.focusedProperty && k.frame === f.frame);
      const accepted = this.enqueue(
        [{ type: 'setKeyframe', layerId: layer.id, property: f.focusedProperty, frame: f.frame, value: typeof value === 'number' ? value : 0, easing: existing?.easing ?? 'linear' }],
        undefined,
        'timeline',
      );
      if (accepted) this.set({ announcement: keyframeAdded(timeReadout(f.frame)) });
    },
    selectScene: (sceneId) => this.set({ sceneId, selection: [], primary: null, frame: 0 }),
    refresh: () => this.refresh(),
  };

  // ------------------------------------------------------------ live channel

  private connect(): void {
    if (this.disposed) return;
    const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'subscribe', projectId: this.projectId }));
      if (this.lostOnce) {
        this.set({ connection: 'up', announcement: MESSAGES.reconnected });
        void this.refresh();
      }
    };
    socket.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage);
    socket.onclose = () => {
      if (this.disposed) return;
      this.lostOnce = true;
      this.set({ connection: 'down' });
      this.socketTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
        this.set({ people: message.people, locks: new Map(message.locks.map((lock) => [lock.layerId, lock])) });
        if (message.seq > this.lastSeq && this.items.length === 0) void this.refresh();
        break;
      case 'presence':
        this.set({ people: message.people });
        break;
      case 'patch':
        this.applyServerPatch(message.seq, message.patch);
        this.commit();
        break;
      case 'lock': {
        const locks = new Map(this.fields.locks);
        locks.set(message.lock.layerId, message.lock);
        this.set({ locks });
        break;
      }
      case 'unlock': {
        const locks = new Map(this.fields.locks);
        locks.delete(message.layerId);
        this.set({ locks });
        break;
      }
      case 'version':
        this.set({ project: { ...this.fields.project, liveVersion: message.number }, versionTick: this.fields.versionTick + 1 });
        break;
      case 'members':
        this.set({ membersTick: this.fields.membersTick + 1 });
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.socketTimer !== undefined) clearTimeout(this.socketTimer);
    this.socket?.close();
  }
}

;
