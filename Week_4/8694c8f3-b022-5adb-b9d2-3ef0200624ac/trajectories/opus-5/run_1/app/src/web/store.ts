import { api, ApiFailure, NetworkFailure, newClientOpId, type OpRequest } from './api.js';
import { applyOpToDocument, findLayer, previewPath, treeRows } from './document.js';
import { evaluateGraph, stageOverrides, type Overrides } from './graph.js';
import { OpQueue } from './opqueue.js';
import { ScriptHost } from './sandbox.js';
import { Transport } from './transport.js';
import type { CompileError, StageRenderer } from './gl/renderer.js';
import { snapToQuarterBeat, type OutputBus } from '../shared/domain.js';
import type {
  ActivityEntry,
  AssetDoc,
  LayerDoc,
  OpDoc,
  PresenceMember,
  Role,
  SetDocument,
  SetSummary,
  ShaderVersionSummary,
  ShowBundle,
  ShowVersionDoc,
  UserDoc,
} from '../shared/types.js';

export type RigTab = 'layers' | 'assets' | 'shows' | 'activity';
export type DockTab = 'timeline' | 'shader' | 'graph' | 'script' | 'console';
export type GizmoMode = 'move' | 'rotate' | 'scale';

export interface LockRecord {
  holder: { user_id: string; display_name: string };
  expires_at: string;
}

export interface ConflictState {
  op: OpRequest;
  layerName: string;
  changedBy: string;
}

export interface Regions {
  autosave: string;
  shaderCompile: string;
  assetUpload: string;
  showStatus: string;
  scriptStatus: string;
  exportStatus: string;
  connection: string;
  serviceStatus: string;
  notifications: string;
}

export interface StoreState {
  user: UserDoc | null;
  sets: SetSummary[];
  doc: SetDocument | null;
  demo: boolean;
  selection: string | null;
  collapsed: string[];
  rigTab: RigTab;
  dockTab: DockTab;
  gizmoMode: GizmoMode;
  gridSnap: boolean;
  angleSnap: boolean;
  playing: boolean;
  tick: number;
  frames: number;
  assets: AssetDoc[];
  members: { user_id: string; display_name: string; email: string; role: Role }[];
  presence: PresenceMember[];
  locks: Record<string, LockRecord>;
  shows: { show_url: string; live_number: number | null; versions: ShowVersionDoc[] } | null;
  activity: ActivityEntry[];
  shaderVersions: ShaderVersionSummary[];
  shaderDraft: string;
  shaderErrors: CompileError[];
  shaderViewing: number | null;
  scriptSelection: string | null;
  scriptDraft: string;
  consoleLines: string[];
  queueCount: number;
  offline: boolean;
  storageDown: boolean;
  collabDown: boolean;
  conflict: ConflictState | null;
  fieldErrors: Record<string, string>;
  errorPath: string | null;
  regions: Regions;
}

const emptyRegions: Regions = {
  autosave: '',
  shaderCompile: '',
  assetUpload: '',
  showStatus: '',
  scriptStatus: '',
  exportStatus: '',
  connection: '',
  serviceStatus: '',
  notifications: '',
};

/** Ops that can change an asset's dependents count. */
function touchesAssets(type: string, payload: Record<string, unknown>): boolean {
  if (type === 'script.save' || type === 'script.remove' || type === 'layer.remove') return true;
  if (type !== 'layer.set') return false;
  const path = typeof payload['path'] === 'string' ? payload['path'] : '';
  return path === 'model_asset_id' || (path.startsWith('material.') && path.endsWith('_texture_id'));
}

export class Store {
  state: StoreState = {
    user: null,
    sets: [],
    doc: null,
    demo: false,
    selection: null,
    collapsed: [],
    rigTab: 'layers',
    dockTab: 'timeline',
    gizmoMode: 'move',
    gridSnap: false,
    angleSnap: false,
    playing: false,
    tick: 0,
    frames: 0,
    assets: [],
    members: [],
    presence: [],
    locks: {},
    shows: null,
    activity: [],
    shaderVersions: [],
    shaderDraft: '',
    shaderErrors: [],
    shaderViewing: null,
    scriptSelection: null,
    scriptDraft: '',
    consoleLines: [],
    queueCount: 0,
    offline: false,
    storageDown: false,
    collabDown: false,
    conflict: null,
    fieldErrors: {},
    errorPath: null,
    regions: { ...emptyRegions },
  };

  readonly transport = new Transport();
  readonly scriptHost: ScriptHost;
  renderer: StageRenderer | null = null;
  canvas: HTMLCanvasElement | null = null;
  bus: OutputBus | null = 'main';
  assetUrl: (assetId: string) => string = (assetId) => `/api/assets/${assetId}/content`;
  showChrome = true;
  shaderSources = new Map<string, string>();
  private listeners = new Set<() => void>();
  private queue: OpQueue | null = null;
  private stream: EventSource | null = null;
  private ownOpIds = new Set<string>();
  private interactions = 0;
  private frameHandle: number | null = null;
  private head = 0;
  private graphOverrides: Overrides = new Map();
  private assetsLoaded = new Set<string>();
  private lastPublish = 0;
  private afterAck = new Map<string, () => void>();
  private sawOffline = false;
  private reconnectPending = false;

  constructor() {
    this.scriptHost = new ScriptHost({
      onConsole: (line) => {
        this.patch({ consoleLines: [...this.state.consoleLines, line].slice(-200) });
      },
      onStatus: (line) => {
        this.region('scriptStatus', line);
        this.patch({ consoleLines: [...this.state.consoleLines, line].slice(-200) });
      },
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): StoreState => this.state;

  private announce(): void {
    for (const listener of this.listeners) listener();
  }

  patch(next: Partial<StoreState>): void {
    this.state = { ...this.state, ...next };
    this.announce();
  }

  region(name: keyof Regions, text: string): void {
    this.patch({ regions: { ...this.state.regions, [name]: text } });
  }

  // --- stage loop -------------------------------------------------------

  attachRenderer(renderer: StageRenderer | null, canvas: HTMLCanvasElement | null): void {
    this.renderer = renderer;
    this.canvas = canvas;
    this.markDirty();
  }

  /** Previews a value on the drawn stage; the op follows on release. */
  preview(layerId: string, path: string, value: unknown): void {
    const doc = this.state.doc;
    if (doc === null) return;
    this.patch({ doc: previewPath(doc, layerId, path, value) });
    this.markDirty();
  }

  private reducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  beginInteraction(): void {
    this.interactions += 1;
    if (!this.reducedMotion()) this.markDirty();
  }

  endInteraction(): void {
    this.interactions = Math.max(0, this.interactions - 1);
    this.markDirty();
  }

  markDirty(): void {
    /* With reduced motion an interaction redraws once, on release. */
    if (this.interactions > 0 && this.reducedMotion() && !this.transport.playing) return;
    if (this.frameHandle !== null) return;
    this.frameHandle = window.requestAnimationFrame((moment) => {
      this.frameHandle = null;
      this.frame(moment);
    });
  }

  private frame(moment: number): void {
    const doc = this.state.doc;
    const renderer = this.renderer;
    if (doc !== null && renderer !== null) {
      const crossed = this.transport.advance(moment);
      this.transport.bpm = doc.set.bpm;
      for (const beat of crossed) {
        this.scriptHost.runBeat(beat, doc.set.bpm, (layerName) => {
          const layer = doc.layers.find((candidate) => candidate.name === layerName);
          return layer === undefined ? null : layer.id;
        });
      }
      if (this.transport.playing) {
        this.graphOverrides = evaluateGraph(doc.graph, this.transport.beats, this.scriptHost.plugins);
      }
      const overrides = stageOverrides(
        doc,
        this.transport.tick,
        this.transport.playing ? this.graphOverrides : new Map(),
        this.scriptHost.overrides,
      );
      renderer.draw({
        doc,
        overrides,
        shaderSources: this.shaderSources,
        beat: this.transport.beats,
        seconds: this.transport.seconds,
        selection: this.state.selection,
        bus: this.bus,
        showChrome: this.showChrome,
      });
      this.publishFrame(renderer);
    }
    const keepGoing = this.transport.playing || (this.interactions > 0 && !this.reducedMotion());
    if (keepGoing) {
      this.frameHandle = window.requestAnimationFrame((next) => {
        this.frameHandle = null;
        this.frame(next);
      });
    }
  }

  /** The canvas carries the frame count and the gizmo grip centres. */
  private publishFrame(renderer: StageRenderer): void {
    const canvas = this.canvas;
    if (canvas !== null) {
      canvas.setAttribute('data-frame', String(renderer.frames));
      const grips = renderer.grips;
      for (const axis of ['x', 'y', 'z'] as const) {
        const grip = grips?.[axis];
        if (grip === undefined) canvas.removeAttribute(`data-gizmo-${axis}`);
        else canvas.setAttribute(`data-gizmo-${axis}`, `${grip[0]},${grip[1]}`);
      }
    }
    const now = performance.now();
    if (now - this.lastPublish < 80) return;
    this.lastPublish = now;
    this.patch({ frames: renderer.frames, tick: this.transport.tick });
  }

  // --- transport --------------------------------------------------------

  play(): void {
    this.transport.play();
    this.patch({ playing: true });
    this.markDirty();
  }

  pause(): void {
    this.transport.pause();
    this.patch({ playing: false });
    this.markDirty();
  }

  stop(): void {
    this.transport.stop();
    this.patch({ playing: false, tick: 0 });
    this.markDirty();
  }

  stepBeat(): void {
    this.transport.stepBeat();
    this.patch({ tick: this.transport.tick });
    this.markDirty();
  }

  seek(tick: number): void {
    this.transport.seek(tick);
    this.patch({ tick: this.transport.tick });
    this.markDirty();
  }

  togglePlay(): void {
    if (this.transport.playing) this.pause();
    else this.play();
  }

  // --- document ---------------------------------------------------------

  openDemo(doc: SetDocument, shaderSources: Map<string, string>): void {
    this.shaderSources = shaderSources;
    this.transport.bpm = doc.set.bpm;
    this.patch({ doc, demo: true, selection: doc.layers[0]?.id ?? null });
    this.markDirty();
  }

  /** The show page plays the frozen bundle exactly as it was published. */
  openShowBundle(bundle: ShowBundle): void {
    const doc: SetDocument = {
      set: {
        id: 'show',
        name: bundle.set.name,
        bpm: bundle.set.bpm,
        head: 0,
        settings_version: 1,
        graph_version: bundle.graph.version,
        active_camera_id: bundle.set.active_camera_id,
        show_token: 'show',
        role: 'viewer',
      },
      layers: bundle.layers,
      keys: bundle.keys,
      graph: bundle.graph,
      scripts: bundle.scripts,
    };
    this.shaderSources = new Map(bundle.shaders.map((shader) => [shader.layer_id, shader.source]));
    this.transport.bpm = bundle.set.bpm;
    this.patch({ doc, demo: true, selection: null, assets: [] });
    this.scriptHost.load(bundle.scripts);
    for (const asset of bundle.assets) {
      if (this.assetsLoaded.has(asset.id)) continue;
      this.assetsLoaded.add(asset.id);
      void this.loadAsset({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        size: asset.size,
        sha256: asset.sha256,
        status: 'ready',
        created_at: '',
        dependents: { count: 0, layers: [], materials: [], scripts: [] },
      });
    }
    this.markDirty();
  }

  async openSet(setId: string): Promise<void> {
    const doc = await api.getSet(setId);
    this.head = doc.set.head;
    this.transport.bpm = doc.set.bpm;
    this.patch({
      doc,
      demo: false,
      selection: doc.layers[0]?.id ?? null,
      scriptSelection: doc.scripts[0]?.id ?? null,
      scriptDraft: doc.scripts[0]?.source ?? '',
      regions: { ...emptyRegions },
    });
    this.scriptHost.load(doc.scripts);
    this.queue = new OpQueue(setId, {
      onChange: () => this.queueChanged(),
      onAcknowledged: (op) => {
        const after = this.afterAck.get(op.client_op_id);
        this.afterAck.delete(op.client_op_id);
        after?.();
        if (touchesAssets(op.type, op.payload)) void this.refreshAssets();
        this.queueChanged();
      },
      onRefused: (op, failure) => this.opRefused(op, failure),
    });
    void this.queue.flush();
    await Promise.all([
      this.loadShaderSources(doc),
      this.refreshAssets(),
      this.refreshShows(),
      this.refreshMembers(),
      this.refreshActivity(),
      this.refreshLocks(),
    ]);
    this.openStream(setId);
    this.startTimers(setId);
    this.markDirty();
  }

  private async loadShaderSources(doc: SetDocument): Promise<void> {
    for (const layer of doc.layers) {
      if (layer.kind !== 'shader' || layer.shader_version === null) continue;
      const version = await api.getShaderVersion(doc.set.id, layer.id, layer.shader_version);
      this.shaderSources.set(layer.id, version.source);
    }
    const selected = this.state.selection;
    if (selected !== null) this.patch({ shaderDraft: this.shaderSources.get(selected) ?? '' });
  }

  private openStream(setId: string): void {
    this.stream?.close();
    const stream = new EventSource(`/api/sets/${setId}/events?after=${this.head}`);
    this.stream = stream;
    stream.addEventListener('op', (event) => {
      const op = JSON.parse((event as MessageEvent<string>).data) as OpDoc;
      this.applyRemoteOp(op);
    });
    stream.addEventListener('lock', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        layer_id: string;
        holder: LockRecord['holder'] | null;
        expires_at: string | null;
        reason: string;
      };
      const locks = { ...this.state.locks };
      if (data.holder === null || data.expires_at === null) {
        const previous = locks[data.layer_id];
        delete locks[data.layer_id];
        if (
          data.reason === 'expired' &&
          previous !== undefined &&
          previous.holder.user_id === this.state.user?.id
        ) {
          const layer = findLayer(this.state.doc as SetDocument, data.layer_id);
          this.region('notifications', `Your lock on ${layer?.name ?? 'the layer'} expired`);
        }
      } else {
        locks[data.layer_id] = { holder: data.holder, expires_at: data.expires_at };
      }
      this.patch({ locks });
    });
    stream.addEventListener('presence', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { members: PresenceMember[] };
      this.patch({ presence: data.members });
    });
    stream.addEventListener('show', () => {
      void this.refreshShows();
    });
  }

  private startTimers(setId: string): void {
    window.setInterval(() => void this.postPresence(), 10_000);
    window.setInterval(() => void this.heartbeatLock(), 10_000);
    window.setInterval(() => void this.refreshStatus(), 5000);
    window.setInterval(() => {
      if (this.state.collabDown) void this.catchUp(setId);
    }, 5000);
    void this.refreshStatus();
    void this.postPresence();
  }

  private async catchUp(setId: string): Promise<void> {
    try {
      const result = await api.listOps(setId, this.head);
      for (const op of result.ops) this.applyRemoteOp(op);
    } catch {
      /* the connection banner already says the link is down */
    }
  }

  private applyRemoteOp(op: OpDoc): void {
    this.head = Math.max(this.head, op.seq);
    if (this.ownOpIds.has(op.client_op_id)) return;
    const doc = this.state.doc;
    if (doc === null) return;
    const next = applyOpToDocument(doc, { target: op.target, type: op.type, payload: op.payload });
    this.patch({ doc: { ...next, set: { ...next.set, head: this.head } } });
    if (op.type === 'script.add' || op.type === 'script.save' || op.type === 'script.remove') {
      this.scriptHost.load(next.scripts);
    }
    if (op.type === 'shader.save' || op.type === 'shader.restore') {
      void this.refreshShaderLayer(op.target);
    }
    if (touchesAssets(op.type, op.payload)) void this.refreshAssets();
    this.transport.bpm = next.set.bpm;
    this.markDirty();
  }

  private async refreshShaderLayer(layerId: string): Promise<void> {
    const doc = this.state.doc;
    if (doc === null) return;
    const layer = findLayer(doc, layerId);
    if (layer === null || layer.shader_version === null) return;
    const version = await api.getShaderVersion(doc.set.id, layerId, layer.shader_version);
    this.shaderSources.set(layerId, version.source);
    if (this.state.selection === layerId) this.patch({ shaderDraft: version.source });
    await this.refreshShaderVersions(layerId);
    this.markDirty();
  }

  // --- ops --------------------------------------------------------------

  /** Commits one edit: applied on the stage at once, then sent as one op. */
  commit(
    op: { target: string; type: string; payload: Record<string, unknown>; baseVersion?: number | null },
    onCommitted?: () => void,
  ): void {
    const doc = this.state.doc;
    if (doc === null) return;
    const next = applyOpToDocument(doc, { target: op.target, type: op.type, payload: op.payload });
    this.patch({ doc: next, fieldErrors: {}, errorPath: null });
    this.transport.bpm = next.set.bpm;
    this.markDirty();
    if (this.state.demo || this.queue === null) return;
    const request: OpRequest = {
      client_op_id: newClientOpId(),
      target: op.target,
      base_version: op.baseVersion ?? null,
      type: op.type,
      payload: op.payload,
    };
    this.ownOpIds.add(request.client_op_id);
    if (onCommitted !== undefined) this.afterAck.set(request.client_op_id, onCommitted);
    this.queue.push(request);
  }

  private queueChanged(): void {
    const queue = this.queue;
    if (queue === null) return;
    const count = queue.count;
    const offline = queue.offline;
    const regions = { ...this.state.regions };
    if (offline) this.sawOffline = true;
    if (offline && count > 0) {
      regions.autosave = 'Waiting to sync';
      regions.connection =
        count === 1
          ? 'Connection lost. 1 change waiting to sync.'
          : `Connection lost. ${count} changes waiting to sync.`;
    } else if (count > 0 || queue.inFlight) {
      regions.autosave = 'Saving';
      regions.connection = '';
    } else {
      regions.autosave = regions.autosave === 'Save failed' ? regions.autosave : 'Saved';
      regions.connection = '';
      if (this.sawOffline) this.reconnectPending = true;
    }
    this.patch({ queueCount: count, offline, regions });
    this.announceReconnect();
  }

  /** The reconnect toast waits until any conflict from the replay is resolved. */
  private announceReconnect(): void {
    if (!this.reconnectPending || this.state.conflict !== null) return;
    if ((this.queue?.count ?? 0) > 0) return;
    this.reconnectPending = false;
    this.sawOffline = false;
    this.region('notifications', 'Back online. All changes synced.');
  }

  private opRefused(op: OpRequest, failure: ApiFailure): void {
    const body = failure.body;
    if (failure.status === 409 && body.code === 'stale_version') {
      const current = body.current as LayerDoc | undefined;
      const doc = this.state.doc;
      if (doc !== null && current !== undefined && typeof current === 'object' && 'id' in current) {
        this.patch({
          doc: { ...doc, layers: doc.layers.map((layer) => (layer.id === current.id ? current : layer)) },
        });
      }
      const layer = findLayer(this.state.doc as SetDocument, op.target);
      this.patch({
        conflict: {
          op,
          layerName: layer?.name ?? 'this layer',
          changedBy: body.changed_by?.display_name ?? 'Another editor',
        },
      });
      this.markDirty();
      return;
    }
    if (failure.status === 423) {
      this.region('notifications', `This layer is locked by ${body.holder?.display_name ?? 'another editor'}`);
      void this.reload();
      return;
    }
    if (failure.status === 422) {
      this.patch({
        fieldErrors: body.fields ?? {},
        errorPath: typeof op.payload['path'] === 'string' ? op.payload['path'] : null,
        regions: { ...this.state.regions, autosave: 'Save failed' },
      });
      return;
    }
    if (failure.status === 503) {
      this.region('serviceStatus', body.message);
    }
  }

  async reload(): Promise<void> {
    const doc = this.state.doc;
    if (doc === null) return;
    const fresh = await api.getSet(doc.set.id);
    this.head = fresh.set.head;
    this.patch({ doc: fresh });
    this.markDirty();
  }

  resolveConflict(choice: 'theirs' | 'mine'): void {
    const conflict = this.state.conflict;
    this.patch({ conflict: null });
    if (conflict === null || choice === 'theirs') {
      this.announceReconnect();
      return;
    }
    const layer = findLayer(this.state.doc as SetDocument, conflict.op.target);
    this.commit({
      target: conflict.op.target,
      type: conflict.op.type,
      payload: conflict.op.payload,
      baseVersion: layer?.version ?? null,
    });
  }

  // --- selection, locks, presence ---------------------------------------

  select(layerId: string | null): void {
    const previous = this.state.selection;
    if (previous === layerId) return;
    if (previous !== null && this.heldByMe(previous)) void this.releaseLock(previous);
    this.patch({
      selection: layerId,
      shaderDraft: layerId === null ? '' : this.shaderSources.get(layerId) ?? '',
      shaderErrors: [],
      shaderViewing: null,
      fieldErrors: {},
    });
    if (layerId !== null) {
      const layer = findLayer(this.state.doc as SetDocument, layerId);
      if (layer?.kind === 'shader') void this.refreshShaderVersions(layerId);
    }
    void this.postPresence();
    this.markDirty();
  }

  heldByMe(layerId: string): boolean {
    return this.state.locks[layerId]?.holder.user_id === this.state.user?.id;
  }

  async takeLock(layerId: string): Promise<void> {
    try {
      const lease = await api.takeLock(this.setId, layerId);
      this.patch({
        locks: {
          ...this.state.locks,
          [layerId]: { holder: lease.holder, expires_at: lease.expires_at },
        },
      });
    } catch (error) {
      if (error instanceof ApiFailure && error.body.code === 'lock_held') {
        this.region('notifications', `Locked by ${error.body.holder?.display_name ?? 'another editor'}`);
      } else if (error instanceof ApiFailure && error.body.code === 'collab_offline') {
        this.region('serviceStatus', error.body.message);
      }
    }
  }

  async releaseLock(layerId: string): Promise<void> {
    try {
      await api.releaseLock(this.setId, layerId);
      const locks = { ...this.state.locks };
      delete locks[layerId];
      this.patch({ locks });
    } catch {
      /* the lock state follows server lock events */
    }
  }

  private async heartbeatLock(): Promise<void> {
    const selection = this.state.selection;
    if (selection === null || !this.heldByMe(selection)) return;
    try {
      const result = await api.heartbeatLock(this.setId, selection);
      this.patch({
        locks: {
          ...this.state.locks,
          [selection]: {
            holder: this.state.locks[selection]?.holder ?? {
              user_id: this.state.user?.id ?? '',
              display_name: this.state.user?.display_name ?? '',
            },
            expires_at: result.expires_at,
          },
        },
      });
    } catch {
      /* an expired lease arrives as a lock event */
    }
  }

  private async postPresence(retry = true): Promise<void> {
    if (this.state.doc === null || this.state.demo) return;
    try {
      const result = await api.postPresence(this.setId, this.state.selection);
      this.patch({ presence: result.members });
    } catch (error) {
      /* a selection the server has not seen yet settles once its op commits */
      if (retry && error instanceof ApiFailure && error.status === 422) {
        window.setTimeout(() => void this.postPresence(false), 600);
      }
    }
  }

  // --- panels -----------------------------------------------------------

  get setId(): string {
    return this.state.doc?.set.id ?? '';
  }

  async refreshAssets(): Promise<void> {
    if (this.state.demo) return;
    const result = await api.listAssets(this.setId);
    this.patch({ assets: result.assets });
    for (const asset of result.assets) {
      if (asset.status !== 'ready' || this.assetsLoaded.has(asset.id)) continue;
      this.assetsLoaded.add(asset.id);
      void this.loadAsset(asset);
    }
  }

  private async loadAsset(asset: AssetDoc): Promise<void> {
    const renderer = this.renderer;
    if (renderer === null) {
      this.assetsLoaded.delete(asset.id);
      return;
    }
    const response = await fetch(this.assetUrl(asset.id), { credentials: 'same-origin' });
    if (!response.ok) return;
    if (asset.kind === 'texture') {
      const bitmap = await createImageBitmap(await response.blob());
      renderer.setTexture(asset.id, bitmap);
    } else {
      const { parseGlb } = await import('./gl/glb.js');
      renderer.setModel(asset.id, parseGlb(await response.arrayBuffer()));
    }
    this.markDirty();
  }

  async refreshShows(): Promise<void> {
    if (this.state.demo) return;
    this.patch({ shows: await api.listShows(this.setId) });
  }

  async refreshMembers(): Promise<void> {
    if (this.state.demo) return;
    const result = await api.listMembers(this.setId);
    this.patch({ members: result.members });
  }

  async refreshActivity(): Promise<void> {
    if (this.state.demo) return;
    const result = await api.listActivity(this.setId);
    this.patch({ activity: result.entries });
  }

  async refreshLocks(): Promise<void> {
    if (this.state.demo) return;
    try {
      const result = await api.listLocks(this.setId);
      const locks: Record<string, LockRecord> = {};
      for (const lock of result.locks) {
        if (lock.holder === null || lock.expires_at === null) continue;
        locks[lock.layer_id] = { holder: lock.holder, expires_at: lock.expires_at };
      }
      this.patch({ locks });
    } catch {
      /* locks stay as they are while live collaboration is offline */
    }
  }

  async refreshShaderVersions(layerId: string): Promise<void> {
    try {
      const result = await api.listShaderVersions(this.setId, layerId);
      this.patch({ shaderVersions: result.versions });
    } catch {
      /* the list arrives once the layer's own op has committed */
    }
  }

  private async refreshStatus(): Promise<void> {
    try {
      const status = await api.status();
      const storageDown = status.storage !== 'ok';
      const collabDown = status.collab !== 'ok';
      const regions = { ...this.state.regions };
      if (storageDown) regions.serviceStatus = 'Asset storage is unreachable. Uploads and publishing are paused.';
      else if (collabDown) regions.serviceStatus = 'Live collaboration is offline. Locks can\u2019t be taken right now.';
      else regions.serviceStatus = '';
      this.patch({ storageDown, collabDown, regions });
    } catch {
      /* the connection banner covers a lost link to the app itself */
    }
  }

  // --- editing helpers --------------------------------------------------

  keyProperty(layerId: string, property: string, value: number): void {
    const layer = findLayer(this.state.doc as SetDocument, layerId);
    if (layer === null) return;
    this.commit({
      target: layerId,
      type: 'key.set',
      payload: { property, tick: snapToQuarterBeat(this.transport.tick), value },
      baseVersion: layer.version,
    });
  }

  removeKey(layerId: string, property: string, tick: number): void {
    const layer = findLayer(this.state.doc as SetDocument, layerId);
    if (layer === null) return;
    this.commit({
      target: layerId,
      type: 'key.remove',
      payload: { property, tick },
      baseVersion: layer.version,
    });
  }

  setLayerPath(layerId: string, path: string, value: unknown): void {
    const layer = findLayer(this.state.doc as SetDocument, layerId);
    if (layer === null) return;
    this.commit({
      target: layerId,
      type: 'layer.set',
      payload: { path, value },
      baseVersion: layer.version,
    });
  }

  visibleRows(): LayerDoc[] {
    const doc = this.state.doc;
    if (doc === null) return [];
    const collapsed = new Set(this.state.collapsed);
    const rows = treeRows(doc);
    return rows.filter((row) => {
      let parentId = row.parent_id;
      while (parentId !== null) {
        if (collapsed.has(parentId)) return false;
        parentId = findLayer(doc, parentId)?.parent_id ?? null;
      }
      return true;
    });
  }

  toggleCollapsed(layerId: string, collapsed: boolean): void {
    const current = new Set(this.state.collapsed);
    if (collapsed) current.add(layerId);
    else current.delete(layerId);
    this.patch({ collapsed: [...current] });
  }

  async signOut(): Promise<void> {
    try {
      await api.logout();
    } catch (error) {
      if (!(error instanceof NetworkFailure)) throw error;
    }
    window.location.assign('/');
  }
}

export const store = new Store();
