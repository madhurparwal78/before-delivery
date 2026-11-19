import { api, OfflineError, ApiError } from './api.js';
import type { SetDoc, LayerDoc, OpEvent, LockEvent, PresenceMember } from './api.js';
import type { NodeDefinition } from './graph.js';
import { uid } from './dom.js';

export interface OpRequest {
  client_op_id: string;
  target: string;
  base_version: number | undefined;
  type: string;
  payload: Record<string, unknown>;
}

export interface QueuedOp {
  op: OpRequest;
  applyLocal: () => void;
  resolve: (response: Record<string, unknown>) => void;
  reject: (error: ApiError) => void;
}

export type SaveState = 'saved' | 'saving' | 'queued' | 'failed';

// The set store: one copy of the committed state, the op queue for offline
// editing, and the live event stream that keeps other editors in sync.
export class SetStore {
  private doc: SetDoc | null = null;
  private readonly queue: QueuedOp[] = [];
  // Client op ids this browser already committed; their SSE echoes are skipped.
  private readonly ownOpIds = new Set<string>();
  private inFlight = 0;
  private eventSource: EventSource | null = null;
  private lastSeq = 0;
  online = true;
  readonly listeners = new Set<() => void>();
  readonly presenceListeners = new Set<(members: PresenceMember[]) => void>();
  readonly lockListeners = new Set<(event: LockEvent) => void>();
  readonly showListeners = new Set<(liveNumber: number) => void>();
  readonly pluginListeners = new Set<(nodes: NodeDefinition[]) => void>();
  private presence: PresenceMember[] = [];
  private locks = new Map<string, { holder: { user_id: string; display_name: string }; expires_at: string }>();
  private offlineKey = 'afterglass-queue';

  constructor (private readonly setId: string) {}

  async load (): Promise<void> {
    const result = await api.get<SetDoc>(`/api/sets/${this.setId}`);
    if (!result.ok) throw result.error;
    this.doc = result.body;
    this.lastSeq = result.body.set.head;
    this.notify();
  }

  getDocument (): SetDoc | null { return this.doc; }

  get head (): number { return this.doc?.set.head ?? 0; }

  layerVersion (layerId: string): number {
    return this.doc?.layers.find((l) => l.id === layerId)?.version ?? 1;
  }

  get settingsVersion (): number { return this.doc?.set.settings_version ?? 1; }

  get graphVersion (): number { return this.doc?.set.graph_version ?? 1; }

  scriptVersion (scriptId: string): number {
    return this.doc?.scripts.find((s) => s.id === scriptId)?.version ?? 1;
  }

  // Sends an op. Offline or failed requests queue in order and replay later.
  async sendOp (op: Omit<OpRequest, 'client_op_id' | 'base_version'> & { baseVersion: number | undefined; applyLocal: () => void }): Promise<Record<string, unknown>> {
    const { baseVersion, applyLocal, ...rest } = op;
    const request: OpRequest = { client_op_id: uid('op'), base_version: baseVersion, ...rest };
    this.ownOpIds.add(request.client_op_id);
    const queued: QueuedOp = {
      op: request,
      applyLocal,
      resolve: () => {},
      reject: () => {},
    };
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      queued.resolve = resolve;
      queued.reject = reject;
    });
    try {
      if (!this.online) throw new OfflineError();
      const result = await api.post<{ seq: number; target: string; version: number; replayed: boolean }>(`/api/sets/${this.setId}/ops`, request);
      if (!result.ok) throw result.error;
      queued.resolve(result.body);
      // The change applies to the local copy once, after the server commits it.
      applyLocal();
      this.applyAck(request);
      return result.body;
    } catch (error) {
      if (error instanceof OfflineError || error instanceof TypeError) {
        // The request failed to reach the server: queue it and mark offline.
        this.online = false;
        this.queue.push(queued);
        applyLocal();
        this.persistQueue();
        this.notify();
        return promise;
      }
      if (error instanceof ApiError && error.status === 0) {
        this.queue.push(queued);
        applyLocal();
        this.persistQueue();
        this.notify();
        return promise;
      }
      throw error;
    }
  }

  // A committed op moves the local head only; the caller's applyLocal already
  // made the change itself, so the op is never applied twice here.
  private applyAck (request: OpRequest): void {
    if (this.doc === null) return;
    const seq = (this.doc.set.head ?? 0) + 1;
    this.doc.set.head = seq;
    this.lastSeq = Math.max(this.lastSeq, seq);
    this.notify();
    void request;
  }

  // Applies one op to the local state. Also used for remote ops off the stream.
  applyOpLocally (event: OpEvent): void {
    const doc = this.doc;
    if (doc === null) return;
    const { target, type, payload } = event;
    const p = payload as Record<string, unknown>;
    if (type === 'layer.add') {
      const layer = makeLayerFromOp(target, p);
      doc.layers.push(layer);
    } else if (type === 'layer.set') {
      const layer = doc.layers.find((l) => l.id === target);
      if (layer !== undefined) {
        applyLayerSet(layer, p);
        layer.version += 1;
      }
    } else if (type === 'layer.reparent') {
      const layer = doc.layers.find((l) => l.id === target);
      if (layer !== undefined) {
        layer.parent_id = (p.parent_id as string | null) ?? null;
        layer.version += 1;
      }
    } else if (type === 'layer.remove') {
      const ids = new Set<string>([target]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const layer of doc.layers) {
          if (layer.parent_id !== null && ids.has(layer.parent_id) && !ids.has(layer.id)) {
            ids.add(layer.id);
            grew = true;
          }
        }
      }
      doc.layers = doc.layers.filter((l) => !ids.has(l.id));
    } else if (type === 'shader.save' || type === 'shader.restore') {
      const layer = doc.layers.find((l) => l.id === target);
      if (layer !== undefined) {
        if (type === 'shader.save' && typeof p.source === 'string') layer.shader_source = p.source;
        layer.shader_version = (layer.shader_version ?? 0) + 1;
        layer.version += 1;
      }
    } else if (type === 'key.set' || type === 'key.remove') {
      const layer = doc.layers.find((l) => l.id === target);
      if (layer !== undefined) {
        layer.version += 1;
        if (type === 'key.set') {
          const existing = doc.keys.find((k) => k.layer_id === target && k.property === p.property && k.tick === p.tick);
          if (existing !== undefined) existing.value = p.value as number;
          else doc.keys.push({ layer_id: target, property: p.property as string, tick: p.tick as number, value: p.value as number });
        } else {
          doc.keys = doc.keys.filter((k) => !(k.layer_id === target && k.property === p.property && k.tick === p.tick));
        }
      }
    } else if (type === 'set.update') {
      if (p.bpm !== undefined) doc.set.bpm = p.bpm as number;
      if (p.name !== undefined) doc.set.name = p.name as string;
      if (p.active_camera_id !== undefined) doc.set.active_camera_id = p.active_camera_id as string | null;
      doc.set.settings_version += 1;
    } else if (type === 'graph.node.add') {
      doc.graph.nodes.push({ node_id: p.node_id as string, type: p.type as string, params: (p.params ?? {}) as Record<string, unknown>, x: p.x as number, y: p.y as number });
      doc.graph.version += 1;
    } else if (type === 'graph.node.update') {
      const node = doc.graph.nodes.find((n) => n.node_id === p.node_id);
      if (node !== undefined) {
        if (p.params !== undefined) node.params = p.params as Record<string, unknown>;
        if (p.x !== undefined) node.x = p.x as number;
        if (p.y !== undefined) node.y = p.y as number;
      }
      doc.graph.version += 1;
    } else if (type === 'graph.node.remove') {
      const nodeId = p.node_id as string;
      doc.graph.nodes = doc.graph.nodes.filter((n) => n.node_id !== nodeId);
      doc.graph.wires = doc.graph.wires.filter((w) => w.from.node_id !== nodeId && w.to.node_id !== nodeId);
      doc.graph.version += 1;
    } else if (type === 'graph.wire.add') {
      doc.graph.wires.push({ wire_id: p.wire_id as string, from: p.from as { node_id: string; port: string }, to: p.to as { node_id: string; port: string } });
      doc.graph.version += 1;
    } else if (type === 'graph.wire.remove') {
      doc.graph.wires = doc.graph.wires.filter((w) => w.wire_id !== p.wire_id);
      doc.graph.version += 1;
    } else if (type === 'script.add') {
      doc.scripts.push({ id: target, name: p.name as string, version: 1, source: p.source as string, asset_ids: [] });
    } else if (type === 'script.save') {
      const script = doc.scripts.find((s) => s.id === target);
      if (script !== undefined) {
        script.source = p.source as string;
        script.asset_ids = p.asset_ids as string[];
        script.version += 1;
      }
    } else if (type === 'script.remove') {
      doc.scripts = doc.scripts.filter((s) => s.id !== target);
    }
    if (event.seq !== undefined) {
      this.lastSeq = Math.max(this.lastSeq, event.seq);
      if (doc !== null) doc.set.head = Math.max(doc.set.head, event.seq);
    }
  }

  // Applies a remote op that arrived from the event stream or a poll. Our own
  // ops echo back over the stream and are skipped; they already applied locally.
  applyRemoteOp (event: OpEvent): void {
    if (event.client_op_id !== undefined && this.ownOpIds.has(event.client_op_id)) {
      if (event.seq !== undefined) this.lastSeq = Math.max(this.lastSeq, event.seq);
      return;
    }
    if (event.seq !== undefined && event.seq <= this.lastSeq) return;
    this.applyOpLocally(event);
    this.notify();
  }

  subscribe (listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify (): void {
    for (const listener of this.listeners) listener();
  }

  // The event stream: committed ops, lock changes, presence and show pointer.
  connectEvents (): void {
    this.eventSource = new EventSource(`/api/sets/${this.setId}/events?after=${this.lastSeq}`);
    this.eventSource.addEventListener('op', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as OpEvent;
      this.applyRemoteOp(data);
    });
    this.eventSource.addEventListener('lock', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as LockEvent;
      this.applyLockEvent(data);
    });
    this.eventSource.addEventListener('presence', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { members: PresenceMember[] };
      this.presence = data.members;
      for (const listener of this.presenceListeners) listener(this.presence);
    });
    this.eventSource.addEventListener('show', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { live_number: number };
      for (const listener of this.showListeners) listener(data.live_number);
    });
    this.eventSource.onerror = () => {
      this.online = false;
      this.notify();
    };
    this.eventSource.onopen = () => {
      this.online = true;
      void this.replayQueue();
      this.notify();
    };
    // The browser also reports the connection itself.
    window.addEventListener('online', () => {
      this.online = true;
      void this.replayQueue();
      this.notify();
    });
    window.addEventListener('offline', () => {
      this.online = false;
      this.notify();
    });

  }

  disconnectEvents (): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  // Live lock state comes only from lock events and lock responses.
  applyLockEvent (event: LockEvent): void {
    if (event.holder === null) this.locks.delete(event.layer_id);
    else this.locks.set(event.layer_id, { holder: event.holder, expires_at: event.expires_at ?? '' });
    for (const listener of this.lockListeners) listener(event);
  }

  setLockFromResponse (layerId: string, holder: { user_id: string; display_name: string }, expiresAt: string): void {
    this.locks.set(layerId, { holder, expires_at: expiresAt });
    for (const listener of this.lockListeners) listener({ layer_id: layerId, holder, expires_at: expiresAt, reason: 'granted' });
  }

  clearLock (layerId: string): void {
    this.locks.delete(layerId);
  }

  lockFor (layerId: string): { holder: { user_id: string; display_name: string }; expires_at: string } | undefined {
    return this.locks.get(layerId);
  }

  get presenceList (): PresenceMember[] { return this.presence; }

  get queueLength (): number { return this.queue.length; }

  // Replays the queue in order; every op applies exactly once through the
  // server's client-op-id dedupe. A refused op leaves the queue and surfaces
  // its error to the caller; a network failure stops the replay.
  async replayQueue (): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      let outcome: { sent: true } | { sent: false; refused: ApiError | null };
      try {
        const result = await api.post<{ seq: number }>(`/api/sets/${this.setId}/ops`, next.op);
        if (result.ok) outcome = { sent: true };
        else if (result.error.status >= 400 && result.error.status < 500 && result.error.body.code !== 'validation') outcome = { sent: false, refused: result.error };
        else outcome = { sent: false, refused: null };
      } catch {
        outcome = { sent: false, refused: null };
      }
      if (!outcome.sent && outcome.refused === null) {
        this.online = false;
        return;
      }
      this.queue.shift();
      if (outcome.sent) {
        next.resolve({} as Record<string, unknown>);
        this.applyAck(next.op);
      } else {
        next.reject(outcome.refused as ApiError);
      }
      this.persistQueue();
      this.online = true;
      this.notify();
    }
  }

  markOffline (): void {
    this.online = false;
    this.notify();
  }

  markOnline (): void {
    this.online = true;
    this.notify();
  }

  // Edits made offline survive a page reload in this browser.
  private persistQueue (): void {
    if (this.queue.length === 0) {
      window.localStorage.removeItem(`${this.offlineKey}:${this.setId}`);
      return;
    }
    window.localStorage.setItem(`${this.offlineKey}:${this.setId}`, JSON.stringify(this.queue.map((q) => q.op)));
  }
}

function makeLayerFromOp (id: string, p: Record<string, unknown>): LayerDoc {
  const kind = p.kind as LayerDoc['kind'];
  const layer: LayerDoc = {
    id,
    parent_id: (p.parent_id as string | null) ?? null,
    index: p.index as number,
    name: p.name as string,
    kind,
    version: 1,
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    props: kind === 'camera' ? { fov: 50, near: 0.1, far: 200 } : kind === 'light' ? { intensity: 1 } : kind === 'tube' ? { twist: 0, radius: 1 } : {},
    material: ['cube', 'sphere', 'plane', 'torus', 'tube', 'model'].includes(kind)
      ? { tint: [1, 1, 1], tint_alpha: 1, albedo_texture_id: null, emissive_texture_id: null }
      : null,
    model_asset_id: null,
    output_buses: ['cube', 'sphere', 'plane', 'torus', 'tube', 'model', 'shader'].includes(kind) ? ['main'] : [],
    shader_version: kind === 'shader' ? 1 : null,
  };
  return layer;
}

function applyLayerSet (layer: LayerDoc, p: Record<string, unknown>): void {
  const path = p.path as string;
  const value = p.value;
  if (path === 'name') layer.name = value as string;
  else if (path === 'visible') layer.visible = value as boolean;
  else if (path === 'position' || path === 'rotation' || path === 'scale') {
    layer[path] = value as [number, number, number];
  } else if (/^(position|rotation|scale)\.(x|y|z)$/.test(path)) {
    const [base, axis] = path.split('.');
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    layer[base as 'position' | 'rotation' | 'scale'][index] = value as number;
  } else if (path.startsWith('props.')) {
    layer.props[path.slice('props.'.length)] = value as number;
  } else if (path.startsWith('material.') && layer.material !== null) {
    const field = path.slice('material.'.length);
    if (field === 'tint') layer.material.tint = value as [number, number, number];
    else if (field === 'tint_alpha') layer.material.tint_alpha = value as number;
    else if (field === 'albedo_texture_id') layer.material.albedo_texture_id = value as string | null;
    else if (field === 'emissive_texture_id') layer.material.emissive_texture_id = value as string | null;
  } else if (path === 'model_asset_id') layer.model_asset_id = value as string | null;
  else if (path === 'output_buses') layer.output_buses = value as string[];
}
