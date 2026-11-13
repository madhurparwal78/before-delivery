import { applyGroup, applyPatch, diffModel, refreshDerived } from '../shared/apply.js';
import type { DrawingModel, Entity, Layer } from '../shared/model.js';
import { emptyModel } from '../shared/model.js';
import type { ModelPatch, OpResult, Operation } from '../shared/operations.js';
import type { XrefSnapshot, SheetSnapshot, ViewportSnapshot } from '../shared/snapshot.js';
import type { Role } from '../shared/transitions.js';
import { type Vec, vec } from '../shared/geometry.js';
import { layerLockToast, remoteChange } from '../shared/announce.js';
import { api, RequestFailed } from './api.js';
import { type ConnectionStatus, type LiveChannel, type LiveMessage, openLive } from './live.js';

export interface SheetPayload extends SheetSnapshot {
  locked: boolean;
  locked_by: string | null;
  versions: { id: string; number: number; state: string; replaced_by: number | null }[];
}

export interface UnderlayPayload {
  id: string;
  key: string;
  bytes: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DrawingPayload {
  id: string;
  name: string;
  folder_id: string;
  role: Role;
  revision: number;
  next_handle: number;
  layers: Layer[];
  entities: Entity[];
  blocks: DrawingModel['blocks'];
  dim_styles: DrawingModel['dim_styles'];
  parameters: DrawingModel['parameters'];
  constraints: DrawingModel['constraints'];
  xrefs: XrefSnapshot[];
  layer_states: DrawingModel['layer_states'];
  underlays: UnderlayPayload[];
  sheets: SheetPayload[];
  members: { username: string; role: Role }[];
  start_view?: { zoom: number; pan_x: number; pan_y: number } | null;
}

export interface IssuePayload {
  id: string;
  version_id: string;
  title: string;
  x: number;
  y: number;
  state: string;
  creator: string;
  rfi_ids: string[];
  rfis: RfiPayload[];
}

export interface RfiPayload {
  id: string;
  issue_id: string;
  question: string;
  state: string;
  asker: string;
  addressee: string;
  ball_in_court: string;
  answer: string | null;
}

export interface MarkupPayload {
  id: string;
  kind: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  text: string | null;
  flag: string | null;
  author: string;
}

export interface ExportJobPayload {
  id: string;
  format: string;
  state: string;
  progress: number;
  download_url: string | null;
}

export interface PresencePerson {
  username: string;
  colour: number;
  x: number;
  y: number;
  zoom: number;
  pan_x: number;
  pan_y: number;
}

export interface QueuedGroup {
  group_id: string;
  command: string;
  base_revision: number;
  ops: Operation[];
  patch: ModelPatch;
}

export interface Aids {
  snap: boolean;
  ortho: boolean;
  grid: boolean;
  polar: boolean;
}

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export type StoreEvent =
  | { kind: 'model' }
  | { kind: 'view' }
  | { kind: 'selection' }
  | { kind: 'presence' }
  | { kind: 'connection' }
  | { kind: 'issues' }
  | { kind: 'markups' }
  | { kind: 'versions' }
  | { kind: 'xref'; name: string; number: number }
  | { kind: 'notice'; text: string }
  | { kind: 'announce'; text: string }
  | { kind: 'role'; role: Role | null }
  | { kind: 'export'; job: ExportJobPayload }
  | { kind: 'rollback' };

export class DrawingStore {
  id = '';
  name = '';
  folderId = '';
  role: Role = 'view';
  username = '';
  model: DrawingModel = emptyModel();
  revision = 0;
  xrefs: XrefSnapshot[] = [];
  sheets: SheetPayload[] = [];
  underlays: UnderlayPayload[] = [];
  members: { username: string; role: Role }[] = [];
  links: { id: string; url: string; version_id: string }[] = [];
  issues: IssuePayload[] = [];
  markups: MarkupPayload[] = [];
  selection = new Set<string>();
  view: View = { zoom: 20, panX: 0, panY: 0 };
  aids: Aids = { snap: true, ortho: false, grid: false, polar: false };
  currentLayer = '0';
  /** A published version is shown read-only, so drawing commands are refused. */
  versionView = false;
  lastPoint: Vec = vec(0, 0);
  snap: { kind: string; x: number; y: number } = { kind: 'none', x: 0, y: 0 };
  presence: PresencePerson[] = [];
  following: string | null = null;
  connection: ConnectionStatus = 'reconnecting';
  offline = false;
  queue: QueuedGroup[] = [];
  inFlight = 0;
  optimistic = new Set<string>();
  xrefNotice: { name: string; number: number } | null = null;
  layout: 'phone' | 'tablet' | 'desk' = 'desk';
  private channel: LiveChannel | null = null;
  private listeners: ((event: StoreEvent) => void)[] = [];

  on(listener: (event: StoreEvent) => void): void {
    this.listeners.push(listener);
  }

  emit(event: StoreEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get pendingOps(): number {
    return this.inFlight + this.queue.reduce((total, group) => total + group.ops.length, 0);
  }

  load(payload: DrawingPayload, username: string): void {
    this.id = payload.id;
    this.name = payload.name;
    this.folderId = payload.folder_id;
    this.role = payload.role;
    this.username = username;
    this.revision = payload.revision;
    const model = emptyModel();
    model.layers = payload.layers;
    model.entities = payload.entities;
    model.blocks = payload.blocks;
    model.dim_styles = payload.dim_styles;
    model.parameters = payload.parameters;
    model.constraints = payload.constraints;
    model.xrefs = payload.xrefs.map((xref) => ({
      name: xref.name,
      source: xref.source,
      x: xref.x,
      y: xref.y,
      scale: xref.scale,
      rotation: xref.rotation,
      clip: xref.clip,
      version_number: xref.version_number,
    }));
    model.layer_states = payload.layer_states;
    model.next_handle = payload.next_handle;
    this.model = model;
    this.xrefs = payload.xrefs;
    this.sheets = payload.sheets;
    this.underlays = payload.underlays;
    this.members = payload.members ?? [];
    if (payload.start_view) {
      this.view = { zoom: payload.start_view.zoom, panX: payload.start_view.pan_x, panY: payload.start_view.pan_y };
    }
    this.restoreQueue();
    this.emit({ kind: 'model' });
  }

  /** Every xref entity, by its full id. */
  xrefEntities(): { id: string; entity: Entity }[] {
    const out: { id: string; entity: Entity }[] = [];
    for (const xref of this.xrefs) {
      for (const entity of xref.entities) out.push({ id: `${xref.name}|${entity.handle}`, entity });
    }
    return out;
  }

  connect(): void {
    if (this.offline) return;
    this.channel = openLive({
      path: `/api/drawings/${this.id}/live`,
      onMessage: (message) => this.receive(message),
      onStatus: (status) => {
        this.connection = status;
        this.emit({ kind: 'connection' });
      },
    });
  }

  disconnect(): void {
    this.channel?.close();
    this.channel = null;
  }

  sendPointer(point: Vec): void {
    this.channel?.send({
      type: 'pointer',
      x: point.x,
      y: point.y,
      zoom: this.view.zoom,
      pan_x: this.view.panX,
      pan_y: this.view.panY,
    });
  }

  private receive(message: LiveMessage): void {
    const data = message.data;
    switch (message.type) {
      case 'ops': {
        const patch = data.patch as ModelPatch | undefined;
        const username = String(data.username ?? '');
        if (!patch) return;
        if (username === this.username) this.clearOptimistic();
        this.revision = Number(data.revision ?? this.revision);
        applyPatch(this.model, patch, 'after', username, this.revision);
        if (Array.isArray(data.xrefs)) this.xrefs = data.xrefs as XrefSnapshot[];
        const handles = Object.keys(patch.entities);
        this.dropMissingFromSelection();
        this.dropLockedFromSelection(patch, username);
        this.emit({ kind: 'model' });
        if (username !== this.username) {
          this.emit({ kind: 'announce', text: remoteChange(username, handles) });
        }
        break;
      }
      case 'presence': {
        this.presence = (data.people as PresencePerson[]) ?? [];
        this.emit({ kind: 'presence' });
        break;
      }
      case 'notice': {
        this.emit({ kind: 'notice', text: String(data.text ?? '') });
        break;
      }
      case 'xref_version': {
        this.xrefNotice = { name: String(data.name ?? ''), number: Number(data.number ?? 0) };
        this.emit({ kind: 'xref', name: this.xrefNotice.name, number: this.xrefNotice.number });
        break;
      }
      case 'issue':
      case 'rfi': {
        this.issues = (data.issues as IssuePayload[]) ?? this.issues;
        this.emit({ kind: 'issues' });
        break;
      }
      case 'markup': {
        this.emit({ kind: 'markups' });
        break;
      }
      case 'version':
      case 'review': {
        this.emit({ kind: 'versions' });
        break;
      }
      case 'export': {
        this.emit({
          kind: 'export',
          job: {
            id: String(data.id ?? ''),
            format: String(data.format ?? ''),
            state: String(data.state ?? ''),
            progress: Number(data.progress ?? 0),
            download_url: typeof data.download_url === 'string' ? data.download_url : null,
          },
        });
        break;
      }
      case 'role': {
        if (String(data.username ?? '') !== this.username) return;
        const role = (data.role as Role | null) ?? null;
        if (role) this.role = role;
        this.emit({ kind: 'notice', text: String(data.text ?? '') });
        this.emit({ kind: 'role', role });
        break;
      }
      default:
        break;
    }
  }

  private clearOptimistic(): void {
    for (const handle of this.optimistic) {
      const index = this.model.entities.findIndex((entity) => entity.handle === handle);
      if (index >= 0) this.model.entities.splice(index, 1);
    }
    this.optimistic.clear();
  }

  /** Locking or freezing a layer takes its entities out of everyone else's selection. */
  private dropLockedFromSelection(patch: ModelPatch, username: string): void {
    if (username === this.username) return;
    for (const [name, change] of Object.entries(patch.layers)) {
      const before = change.before;
      const after = change.after;
      if (!after) continue;
      const closed = (after.locked && !before?.locked) || (after.frozen && !before?.frozen);
      if (!closed) continue;
      const dropped = [...this.selection].filter((handle) => {
        const entity = this.model.entities.find((candidate) => candidate.handle === handle);
        return entity !== undefined && entity.layer === name;
      });
      if (dropped.length === 0) continue;
      for (const handle of dropped) this.selection.delete(handle);
      this.emit({ kind: 'notice', text: layerLockToast(username, name, dropped.length) });
      this.emit({ kind: 'selection' });
    }
  }

  private dropMissingFromSelection(): void {
    for (const handle of [...this.selection]) {
      const entity = this.model.entities.find((candidate) => candidate.handle === handle);
      if (!entity) this.selection.delete(handle);
    }
  }

  private queueKey(): string {
    return `plotfold.queue.${this.id}`;
  }

  private saveQueue(): void {
    window.localStorage.setItem(this.queueKey(), JSON.stringify({ offline: this.offline, queue: this.queue }));
  }

  private restoreQueue(): void {
    const raw = window.localStorage.getItem(this.queueKey());
    if (!raw) return;
    const parsed = JSON.parse(raw) as { offline: boolean; queue: QueuedGroup[] };
    this.queue = parsed.queue ?? [];
    this.offline = parsed.offline ?? false;
    for (const group of this.queue) {
      this.revision = applyPatch(this.model, group.patch, 'after', this.username, this.revision);
    }
  }

  setOffline(offline: boolean): void {
    this.offline = offline;
    this.saveQueue();
    if (offline) {
      this.disconnect();
      this.connection = 'closed';
      this.emit({ kind: 'connection' });
      return;
    }
    this.connect();
    void this.flushQueue();
  }

  async flushQueue(): Promise<void> {
    const groups = [...this.queue];
    if (groups.length === 0) {
      this.emit({ kind: 'connection' });
      return;
    }
    let sent = 0;
    let conflicts = 0;
    for (const group of groups) {
      try {
        const response = await api.post<{ revision: number; results: OpResult[] }>(`/api/drawings/${this.id}/ops`, {
          base_revision: group.base_revision,
          group_id: group.group_id,
          command: group.command,
          ops: group.ops,
        });
        this.revision = response.revision;
        sent += group.ops.length;
        for (const result of response.results) {
          if (result.status !== 'applied') conflicts += 1;
          if (result.message) this.emit({ kind: 'notice', text: result.message });
        }
      } catch (error) {
        if (error instanceof RequestFailed) this.emit({ kind: 'notice', text: error.body.message });
      }
      this.queue = this.queue.filter((candidate) => candidate.group_id !== group.group_id);
      this.saveQueue();
    }
    this.lastFlush = { sent, conflicts };
    this.emit({ kind: 'connection' });
    this.emit({
      kind: 'notice',
      text: `Back online: ${count(sent, 'change', 'changes')} sent, ${count(conflicts, 'conflict', 'conflicts')}.`,
    });
    this.emit({ kind: 'model' });
  }

  lastFlush: { sent: number; conflicts: number } | null = null;

  /** One command run is one operation group: applied here at once, then sent. */
  async submit(
    command: string,
    ops: Operation[],
    options: { draggedPoints?: string[]; optimistic?: boolean } = {},
  ): Promise<OpResult[] | null> {
    if (ops.length === 0) return [];
    const groupId = `grp-${Math.random().toString(36).slice(2, 10)}`;
    const baseRevision = this.revision;
    const before = structuredClone(this.model);
    const handlesBefore = new Set(this.model.entities.map((entity) => entity.handle));
    let localRevision = this.revision;
    try {
      const outcome = applyGroup(this.model, ops, {
        username: this.username,
        baseRevision,
        command,
        revision: this.revision,
        draggedPoints: options.draggedPoints,
      });
      localRevision = outcome.revision;
    } catch (error) {
      this.model = before;
      this.emit({ kind: 'model' });
      this.emit({ kind: 'rollback' });
      throw error;
    }
    const patch = diffModel(before, this.model);
    const newHandles = this.model.entities
      .map((entity) => entity.handle)
      .filter((handle) => !handlesBefore.has(handle));

    if (this.offline) {
      this.revision = localRevision;
      this.queue.push({ group_id: groupId, command, base_revision: baseRevision, ops, patch });
      this.saveQueue();
      this.emit({ kind: 'model' });
      this.emit({ kind: 'connection' });
      return [];
    }

    for (const handle of newHandles) this.optimistic.add(handle);
    this.inFlight += ops.length;
    this.emit({ kind: 'model' });
    try {
      const response = await api.post<{ revision: number; results: OpResult[] }>(`/api/drawings/${this.id}/ops`, {
        base_revision: baseRevision,
        group_id: groupId,
        command,
        ops,
        dragged_points: options.draggedPoints ?? [],
      });
      this.revision = response.revision;
      for (const result of response.results) {
        if (result.message) this.emit({ kind: 'notice', text: result.message });
      }
      return response.results;
    } catch (error) {
      this.model = before;
      for (const handle of newHandles) this.optimistic.delete(handle);
      refreshDerived(this.model);
      this.emit({ kind: 'model' });
      this.emit({ kind: 'rollback' });
      throw error;
    } finally {
      this.inFlight = Math.max(0, this.inFlight - ops.length);
      this.emit({ kind: 'model' });
    }
  }

  /** Offline, an undo removes the last queued group instead. */
  async undo(): Promise<{ command: string } | null> {
    if (this.offline) {
      const group = this.queue.pop();
      if (!group) return null;
      this.revision = applyPatch(this.model, group.patch, 'before', this.username, this.revision);
      this.saveQueue();
      this.emit({ kind: 'model' });
      this.emit({ kind: 'connection' });
      return { command: group.command };
    }
    const response = await api.post<{ revision: number; command: string }>(`/api/drawings/${this.id}/undo`, {});
    this.revision = response.revision;
    return { command: response.command };
  }

  async redo(): Promise<{ command: string } | null> {
    const response = await api.post<{ revision: number; command: string }>(`/api/drawings/${this.id}/redo`, {});
    this.revision = response.revision;
    return { command: response.command };
  }

  async refreshIssues(): Promise<void> {
    const response = await api.get<{ issues: IssuePayload[] }>(`/api/drawings/${this.id}/issues`);
    this.issues = response.issues;
    this.emit({ kind: 'issues' });
  }

  async refreshDrawing(): Promise<void> {
    const payload = await api.get<DrawingPayload>(`/api/drawings/${this.id}`);
    const view = this.view;
    this.load(payload, this.username);
    this.view = view;
    this.emit({ kind: 'model' });
  }
}

export function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export const store = new DrawingStore();
export type { ViewportSnapshot };
