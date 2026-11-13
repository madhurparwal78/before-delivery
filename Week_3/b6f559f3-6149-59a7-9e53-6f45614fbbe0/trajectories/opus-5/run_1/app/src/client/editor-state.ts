import { api, RequestFailed } from './api';
import type { ProjectSummary } from './api';
import { config } from './client-config';
import { MSG } from '../shared/messages';
import type {
  AssetRecord,
  Breakpoint,
  JsonValue,
  Layer,
  Scene,
  SceneDocument,
} from '../shared/types';
import type { LoadedAsset } from '../shared/evaluator';
import { readLayerPath, writeLayerPath } from '../shared/scene-doc';
import { parseGltf } from '../shared/gltf';
import { parseSvgOutline } from '../shared/extrusion';

export interface LockInfo {
  layerId: string;
  personId: string;
  name: string;
}

export interface EditorState {
  project: ProjectSummary;
  document: SceneDocument;
  assets: AssetRecord[];
  loaded: Record<string, LoadedAsset>;
  sceneId: string;
  selection: string[];
  focusedLayerId: string | null;
  focusedProperty: string | null;
  focusedKeyframe: { property: string; frame: number } | null;
  breakpoint: Breakpoint;
  frame: number;
  playing: boolean;
  preview: boolean;
  reduceMotion: boolean;
  reducedMotion: boolean;
  scroll: number;
  vertex: string | null;
  node: string | null;
  clothPoint: string | null;
  particleNumber: number;
  sampleX: number;
  sampleY: number;
  locks: LockInfo[];
  presence: { id: string; name: string }[];
  undoDepth: number;
  redoDepth: number;
  saveStatus: string;
  editorStatus: string;
  notice: string | null;
  phoneTab: 'Layers' | 'Stage' | 'Inspector' | 'Timeline';
  publishing: boolean;
  focusTarget: string | null;
}

export type Change = Record<string, JsonValue>;

interface PendingOp {
  opId: string;
  changes: { change: Change; mergeKey: string | null }[];
  timer: number | null;
  retries: number;
}

export class EditorStore {
  state: EditorState;
  private pending: PendingOp | null = null;
  private listeners: (() => void)[] = [];
  private socket: WebSocket | null = null;
  private readonly personId: string;

  constructor(
    project: ProjectSummary,
    document: SceneDocument,
    assets: AssetRecord[],
    personId: string,
  ) {
    this.personId = personId;
    this.state = {
      project,
      document,
      assets,
      loaded: {},
      sceneId: document.scenes[0]?.id ?? '',
      selection: [],
      focusedLayerId: null,
      focusedProperty: null,
      focusedKeyframe: null,
      breakpoint: 'desktop',
      frame: 0,
      playing: false,
      preview: false,
      reduceMotion: false,
      reducedMotion: false,
      scroll: 0,
      vertex: null,
      node: null,
      clothPoint: null,
      particleNumber: 1,
      sampleX: 100,
      sampleY: 100,
      locks: [],
      presence: [],
      undoDepth: 0,
      redoDepth: 0,
      saveStatus: MSG.saved,
      editorStatus: '',
      notice: null,
      phoneTab: 'Layers',
      publishing: false,
      focusTarget: null,
    };
    void this.loadAssets();
  }

  subscribe(listener: () => void): void {
    this.listeners.push(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  get scene(): Scene | null {
    return this.state.document.scenes.find((scene) => scene.id === this.state.sceneId) ?? null;
  }

  layer(layerId: string | null): Layer | null {
    if (!layerId) return null;
    return this.scene?.layers.find((candidate) => candidate.id === layerId) ?? null;
  }

  get selectedLayer(): Layer | null {
    return this.layer(this.state.selection[0] ?? null);
  }

  get canEdit(): boolean {
    return this.state.project.role !== 'Viewer' && this.state.project.status === 'active';
  }

  heldBy(layerId: string): LockInfo | null {
    const lock = this.state.locks.find((candidate) => candidate.layerId === layerId);
    if (!lock || lock.personId === this.personId) return null;
    return lock;
  }

  private async loadAssets(): Promise<void> {
    const loaded: Record<string, LoadedAsset> = {};
    for (const asset of this.state.assets) {
      let model = null;
      let outline = null;
      if (asset.kind === 'model' || asset.kind === 'svg') {
        try {
          const response = await fetch(`/api/assets/${asset.id}/original`);
          if (response.ok) {
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (asset.kind === 'model') {
              model = parseGltf(bytes, asset.fileName, {
                maxBytes: config().modelMaxBytes,
                maxVertices: config().modelMaxVertices,
              }).model;
            } else {
              outline = parseSvgOutline(new TextDecoder().decode(bytes)).outline;
            }
          }
        } catch {
          model = null;
        }
      }
      loaded[asset.id] = { record: asset, model, outline };
    }
    this.state.loaded = loaded;
    this.emit();
  }

  setStatus(text: string): void {
    this.state.editorStatus = text;
    this.emit();
  }

  setNotice(text: string | null): void {
    this.state.notice = text;
    this.emit();
  }

  /** Writes a value locally, then queues the change for autosave. */
  updateLayerValue(layerId: string, path: string, value: JsonValue): void {
    const layer = this.layer(layerId);
    if (!layer) return;
    if (this.state.breakpoint === 'desktop') {
      writeLayerPath(layer, path, value);
    } else {
      layer.overrides[this.state.breakpoint][path] = value;
    }
    this.queue(
      {
        type: 'updateLayer',
        layerId,
        set: { [path]: value },
        breakpoint: this.state.breakpoint,
      },
      `${layerId}:${path}:${this.state.breakpoint}`,
    );
  }

  clearOverride(layerId: string, path: string): void {
    const layer = this.layer(layerId);
    if (!layer || this.state.breakpoint === 'desktop') return;
    delete layer.overrides[this.state.breakpoint][path];
    this.queue(
      { type: 'clearOverride', layerId, breakpoint: this.state.breakpoint, path },
      `${layerId}:${path}:clear`,
    );
  }

  updateSceneValue(path: string, value: JsonValue): void {
    const scene = this.scene;
    if (!scene) return;
    const parts = path.split('.');
    let target = scene as unknown as Record<string, JsonValue>;
    for (let i = 0; i < parts.length - 1; i += 1) {
      target = target[parts[i]] as Record<string, JsonValue>;
    }
    target[parts[parts.length - 1]] = value;
    this.queue({ type: 'updateScene', set: { [path]: value } }, `scene:${path}`);
  }

  readValue(layer: Layer, path: string): JsonValue | undefined {
    if (this.state.breakpoint !== 'desktop') {
      const level = this.state.breakpoint;
      if (Object.prototype.hasOwnProperty.call(layer.overrides[level], path)) {
        return layer.overrides[level][path];
      }
      if (level === 'mobile' && Object.prototype.hasOwnProperty.call(layer.overrides.tablet, path)) {
        return layer.overrides.tablet[path];
      }
    }
    return readLayerPath(layer, path);
  }

  queue(change: Change, mergeKey: string | null = null): void {
    if (!this.canEdit) {
      this.setNotice(MSG.viewerCantEdit);
      return;
    }
    if (!this.pending) {
      this.pending = {
        opId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        changes: [],
        timer: null,
        retries: 0,
      };
    }
    const last = this.pending.changes[this.pending.changes.length - 1];
    if (mergeKey && last && last.mergeKey === mergeKey) {
      this.pending.changes[this.pending.changes.length - 1] = { change, mergeKey };
    } else {
      this.pending.changes.push({ change, mergeKey });
    }
    this.state.saveStatus = MSG.saving;
    this.emit();
    if (this.pending.timer !== null) window.clearTimeout(this.pending.timer);
    this.pending.timer = window.setTimeout(() => void this.flush(), config().autosaveMs);
  }

  async flush(): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.changes.length === 0) return;
    this.pending = null;
    const body = {
      opId: pending.opId,
      sceneId: this.state.sceneId,
      changes: pending.changes.map((entry) => entry.change as unknown as JsonValue),
    };
    try {
      const result = await api.ops(this.state.project.id, body);
      this.state.undoDepth = result.undoDepth;
      this.state.redoDepth = result.redoDepth;
      this.state.saveStatus = MSG.saved;
      for (const [name, count] of Object.entries(result.variableDeleteCounts ?? {})) {
        this.state.editorStatus = `Deleted ${name}. ${count} ${
          count === 1 ? 'property keeps' : 'properties keep'
        } its last value.`;
      }
      this.emit();
      await this.reload();
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        this.state.saveStatus = MSG.saved;
        this.setNotice(failure.failure.message);
        await this.reload();
        return;
      }
      this.state.saveStatus = MSG.notSaved;
      this.pending = { ...pending, timer: null, retries: pending.retries + 1 };
      this.emit();
      window.setTimeout(() => void this.flush(), 1000);
    }
  }

  async reload(): Promise<void> {
    try {
      const result = await api.project(this.state.project.id);
      this.state.project = result.project;
      this.state.document = result.document;
      if (!result.document.scenes.some((scene) => scene.id === this.state.sceneId)) {
        this.state.sceneId = result.document.scenes[0]?.id ?? '';
      }
      const knownIds = new Set(this.state.assets.map((asset) => asset.id));
      this.state.assets = result.assets;
      if (result.assets.some((asset) => !knownIds.has(asset.id))) {
        await this.loadAssets();
      }
      const locks = await api.locks(this.state.project.id);
      this.state.locks = locks.locks;
      this.emit();
    } catch {
      this.emit();
    }
  }

  async undo(): Promise<void> {
    await this.flush();
    try {
      const result = await api.undo(this.state.project.id, `undo-${Date.now()}`);
      this.state.undoDepth = result.undoDepth;
      this.state.redoDepth = result.redoDepth;
      this.setStatus(MSG.undone);
      await this.reload();
    } catch (failure) {
      if (failure instanceof RequestFailed && failure.failure.error === 'nothing_to_undo') {
        this.setStatus(MSG.nothingToUndo);
        return;
      }
      this.setNotice(failure instanceof RequestFailed ? failure.failure.message : MSG.notSaved);
    }
  }

  async redo(): Promise<void> {
    await this.flush();
    try {
      const result = await api.redo(this.state.project.id, `redo-${Date.now()}`);
      this.state.undoDepth = result.undoDepth;
      this.state.redoDepth = result.redoDepth;
      this.setStatus(MSG.redone);
      await this.reload();
    } catch (failure) {
      if (failure instanceof RequestFailed && failure.failure.error === 'nothing_to_redo') {
        this.setStatus(MSG.nothingToRedo);
        return;
      }
      this.setNotice(failure instanceof RequestFailed ? failure.failure.message : MSG.notSaved);
    }
  }

  async takeLock(layerId: string): Promise<void> {
    if (!this.canEdit) return;
    try {
      await api.takeLock(this.state.project.id, layerId);
    } catch (failure) {
      if (failure instanceof RequestFailed) this.setNotice(failure.failure.message);
    }
  }

  async releaseLock(layerId: string): Promise<void> {
    if (!this.canEdit) return;
    try {
      await api.releaseLock(this.state.project.id, layerId);
    } catch {
      // The lock may already have timed out.
    }
  }

  connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe', projectId: this.state.project.id }));
      if (this.state.editorStatus === MSG.connectionLost) this.setStatus(MSG.reconnected);
    });
    socket.addEventListener('message', (event) => {
      const parsed = JSON.parse(String(event.data)) as Record<string, JsonValue>;
      if (parsed.type === 'presence' && Array.isArray(parsed.people)) {
        this.state.presence = parsed.people as unknown as { id: string; name: string }[];
        this.emit();
        return;
      }
      if (parsed.type === 'changed' || parsed.type === 'lock') {
        void this.reload();
      }
    });
    socket.addEventListener('close', () => {
      this.setStatus(MSG.connectionLost);
      window.setTimeout(() => this.connect(), 1500);
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }
}
