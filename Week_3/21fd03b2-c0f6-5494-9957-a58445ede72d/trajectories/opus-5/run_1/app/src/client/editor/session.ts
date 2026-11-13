import type {
  CheckpointRow,
  LockRow,
  PresencePerson,
  PresenceResponse,
  SceneRecord,
  StatusResponse,
} from '../../shared/api.js';
import { collaborationCopy, saveStatusCopy } from '../../shared/copy.js';
import { defaultParams } from '../../shared/params.js';
import {
  applyOps,
  cloneDocument,
  nextObjectId,
  nextObjectName,
  type Op,
  type SceneDocument,
  type SceneObject,
  type Vec3,
} from '../../shared/scene.js';
import { MAX_STEPS_PER_FRAME, STEP_SECONDS, Simulation, type Body } from '../../shared/sim.js';
import { ROLE_LABELS, canEditScenes, type WorkspaceRole } from '../../shared/states.js';
import { ApiFault, api, toSignIn } from '../api.js';
import { announce } from '../regions.js';

const LEASE_RENEW_MS = 10_000;
const PRESENCE_MS = 2_000;

export type RunMode = 'edit' | 'running' | 'paused';

export interface ConflictState {
  currentRevision: number;
  conflicts: string[];
}

export interface EditorSnapshot {
  loading: boolean;
  missing: boolean;
  scene: SceneRecord | null;
  document: SceneDocument | null;
  revision: number;
  role: WorkspaceRole;
  selectedId: string | null;
  fence: number | null;
  lockHolder: { userId: string; displayName: string } | null;
  locks: LockRow[];
  people: PresencePerson[];
  status: StatusResponse;
  mode: RunMode;
  step: number;
  stateHash: string;
  fps: number;
  frameMs: number;
  bodies: ReadonlyMap<string, Body>;
  conflict: ConflictState | null;
  checkpoints: CheckpointRow[];
  saving: boolean;
}

interface PendingChange {
  changeId: string;
  baseRevision: number;
  ops: Op[];
}

interface HistoryEntry {
  ops: Op[];
  inverse: Op[];
}

function uuid(): string {
  return crypto.randomUUID();
}

function tabId(): string {
  return `tab-${Math.random().toString(36).slice(2, 12)}`;
}

/** Everything the editor does to a scene: selection, leases, autosave, presence and runs. */
export class EditorSession {
  private state: EditorSnapshot = {
    loading: true,
    missing: false,
    scene: null,
    document: null,
    revision: 0,
    role: 'viewer',
    selectedId: null,
    fence: null,
    lockHolder: null,
    locks: [],
    people: [],
    status: { locks: 'ok', storage: 'ok', mail: 'ok' },
    mode: 'edit',
    step: 0,
    stateHash: '',
    fps: 0,
    frameMs: 0,
    bodies: new Map(),
    conflict: null,
    checkpoints: [],
    saving: false,
  };

  private readonly listeners = new Set<() => void>();

  readonly tab = tabId();

  private queue: PendingChange[] = [];

  private sending = false;

  private history: HistoryEntry[] = [];

  private future: HistoryEntry[] = [];

  private stream: EventSource | null = null;

  private timers: number[] = [];

  private simulation: Simulation | null = null;

  private frameHandle = 0;

  private lastFrameAt = 0;

  private accumulator = 0;

  private lastTelemetryAt = 0;

  private cursor: Vec3 | null = null;

  private savedStatusBeforeError: string | null = null;

  private fieldErrors = new Set<string>();

  private knownPeople = new Set<string>();

  private heldObjects = new Map<string, string>();

  myUserId = '';

  myName = '';

  constructor(
    readonly sceneId: string,
    readonly workspaceId: string,
  ) {}

  /* ------------------------------------------------------- lifecycle --- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = (): EditorSnapshot => this.state;

  private patch(change: Partial<EditorSnapshot>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  async start(): Promise<void> {
    try {
      const response = await api<{ scene: SceneRecord; document: SceneDocument }>(
        `/api/scenes/${this.sceneId}`,
      );
      const me = await api<{
        user: { id: string; displayName: string };
        workspaces: { id: string; role: WorkspaceRole }[];
      }>('/api/me');
      this.myUserId = me.user.id;
      this.myName = me.user.displayName;
      const role =
        me.workspaces.find((workspace) => workspace.id === this.workspaceId)?.role ?? 'viewer';
      this.patch({
        loading: false,
        scene: response.scene,
        document: response.document,
        revision: response.scene.revision,
        stateHash: response.scene.stateHash,
        role,
      });
      announce('save', saveStatusCopy.saved);
      this.openStream();
      this.timers.push(
        window.setInterval(() => void this.sendPresence(), PRESENCE_MS),
        window.setInterval(() => void this.renewLease(), LEASE_RENEW_MS),
        window.setInterval(() => void this.flush(), 1_000),
      );
      void this.loadCheckpoints();
      void this.sendPresence();
    } catch (error) {
      if (error instanceof ApiFault && error.status === 404) this.patch({ missing: true, loading: false });
      else this.patch({ loading: false });
    }
  }

  stop(): void {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
    this.stream?.close();
    this.stream = null;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    void fetch(`/api/scenes/${this.sceneId}/presence?tab=${this.tab}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => undefined);
  }

  private openStream(): void {
    const stream = new EventSource(`/api/scenes/${this.sceneId}/live?tab=${this.tab}`);
    this.stream = stream;
    stream.addEventListener('revision', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        revision: number;
        stateHash: string;
      };
      if (data.revision !== this.state.revision) void this.reload(data.revision);
    });
    stream.addEventListener('presence', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as PresenceResponse;
      this.onPresence(data);
    });
    stream.addEventListener('role', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { role: WorkspaceRole };
      if (data.role === this.state.role) return;
      const previous = this.state.role;
      this.patch({ role: data.role });
      if (data.role !== 'owner')
        announce('collaboration', collaborationCopy.roleChanged(this.myName, ROLE_LABELS[data.role]));
      if (data.role === 'viewer' && previous !== 'viewer') {
        this.patch({ fence: null, lockHolder: null });
        announce('save', saveStatusCopy.demoted);
        this.queue = [];
      }
    });
    stream.addEventListener('status', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as StatusResponse;
      this.patch({ status: data });
    });
  }

  private onPresence(data: PresenceResponse): void {
    for (const person of data.people) {
      if (!this.knownPeople.has(person.userId)) {
        this.knownPeople.add(person.userId);
        announce('collaboration', collaborationCopy.joined(person.displayName));
      }
    }
    for (const userId of [...this.knownPeople]) {
      if (!data.people.some((person) => person.userId === userId)) {
        const name = this.state.people.find((person) => person.userId === userId)?.displayName;
        this.knownPeople.delete(userId);
        if (name) announce('collaboration', collaborationCopy.left(name));
      }
    }

    const nextHeld = new Map<string, string>();
    for (const lock of data.locks) nextHeld.set(lock.objectId, lock.holder.displayName);
    for (const [objectId, holder] of nextHeld) {
      if (this.heldObjects.get(objectId) !== holder) {
        const name = this.objectName(objectId);
        announce('collaboration', collaborationCopy.editing(holder, name));
      }
    }
    for (const objectId of this.heldObjects.keys()) {
      if (!nextHeld.has(objectId)) {
        announce('collaboration', collaborationCopy.free(this.objectName(objectId)));
        if (objectId === this.state.selectedId && this.state.lockHolder)
          void this.requestLease(objectId);
      }
    }
    this.heldObjects = nextHeld;
    this.patch({ people: data.people, locks: data.locks });
  }

  private async reload(revision: number): Promise<void> {
    try {
      const response = await api<{ scene: SceneRecord; document: SceneDocument }>(
        `/api/scenes/${this.sceneId}`,
      );
      this.patch({
        scene: response.scene,
        document: response.document,
        revision: response.scene.revision,
        stateHash: response.scene.stateHash,
      });
      void this.loadCheckpoints();
    } catch {
      this.patch({ revision });
    }
  }

  async loadCheckpoints(): Promise<void> {
    try {
      const response = await api<{ checkpoints: CheckpointRow[] }>(
        `/api/scenes/${this.sceneId}/checkpoints`,
      );
      this.patch({ checkpoints: response.checkpoints });
    } catch {
      /* the next load shows them */
    }
  }

  objectName(objectId: string): string {
    return (
      this.state.document?.objects.find((object) => object.id === objectId)?.name ?? objectId
    );
  }

  get canEdit(): boolean {
    return canEditScenes(this.state.role) && this.state.status.locks === 'ok';
  }

  /* ------------------------------------------------------- selection --- */

  async select(objectId: string | null): Promise<void> {
    const previous = this.state.selectedId;
    if (previous === objectId) return;
    if (previous && this.state.fence !== null) void this.releaseLease(previous);
    this.patch({ selectedId: objectId, fence: null, lockHolder: null });
    void this.sendPresence();
    if (objectId && canEditScenes(this.state.role)) await this.requestLease(objectId);
  }

  private async requestLease(objectId: string): Promise<void> {
    try {
      const response = await api<{ lock: LockRow }>(
        `/api/scenes/${this.sceneId}/locks/${objectId}`,
        { method: 'POST', body: { tab: this.tab } },
      );
      if (this.state.selectedId !== objectId) {
        void this.releaseLease(objectId);
        return;
      }
      this.patch({ fence: response.lock.fence, lockHolder: null });
    } catch (error) {
      if (!(error instanceof ApiFault)) return;
      if (error.code === 'lock_held') {
        const holder = (error.details as { holder?: { userId: string; displayName: string } })
          .holder;
        this.patch({ fence: null, lockHolder: holder ?? null });
      } else if (error.code === 'lock_store_unavailable') {
        announce('save', saveStatusCopy.lockOutage);
      } else if (error.status === 403) {
        announce('save', saveStatusCopy.demoted);
      }
    }
  }

  private async releaseLease(objectId: string): Promise<void> {
    try {
      await api(`/api/scenes/${this.sceneId}/locks/${objectId}?tab=${this.tab}`, {
        method: 'DELETE',
      });
    } catch {
      /* the lease expires on the server clock */
    }
  }

  private async renewLease(): Promise<void> {
    const objectId = this.state.selectedId;
    if (!objectId || !canEditScenes(this.state.role)) return;
    if (this.state.fence === null && this.state.lockHolder !== null) return;
    await this.requestLease(objectId);
  }

  setCursor(point: Vec3 | null): void {
    this.cursor = point;
  }

  private async sendPresence(): Promise<void> {
    if (this.state.status.locks === 'down') return;
    try {
      await api(`/api/scenes/${this.sceneId}/presence`, {
        method: 'PUT',
        body: { tab: this.tab, cursor: this.cursor, selected: this.state.selectedId },
      });
    } catch {
      /* presence is refreshed on the next tick */
    }
  }

  /* -------------------------------------------------------- autosave --- */

  /** One change: applied locally at once, then sent as one PATCH. */
  commit(ops: Op[], options: { history?: boolean } = {}): boolean {
    const document = this.state.document;
    if (!document || !this.canEdit || this.state.mode !== 'edit') return false;
    const applied = applyOps(document, ops);
    if (!applied.ok) {
      announce('save', saveStatusCopy.fieldError);
      return false;
    }
    const inverse = this.inverseOf(document, ops);
    if (options.history !== false) {
      this.history.push({ ops, inverse });
      this.future = [];
    }
    this.patch({ document: applied.document });
    this.queue.push({ changeId: uuid(), baseRevision: this.state.revision, ops });
    announce('save', saveStatusCopy.pending);
    this.patch({ saving: true });
    void this.flush();
    return true;
  }

  private inverseOf(document: SceneDocument, ops: readonly Op[]): Op[] {
    const inverse: Op[] = [];
    for (const op of [...ops].reverse()) {
      if (op.op === 'scene') {
        inverse.push({
          op: 'scene',
          field: op.field,
          value: op.field === 'name' ? document.name : document.gravity,
        });
      } else if (op.op === 'add') {
        inverse.push({ op: 'remove', objectId: op.object.id, fence: 0 });
      } else if (op.op === 'remove') {
        const object = document.objects.find((candidate) => candidate.id === op.objectId);
        if (object) inverse.push({ op: 'add', object: cloneObject(object) });
      } else {
        const object = document.objects.find((candidate) => candidate.id === op.objectId);
        if (!object) continue;
        const field = op.field;
        const value = field.startsWith('params.')
          ? object.params[field.slice('params.'.length)]
          : field === 'name'
            ? object.name
            : field === 'position'
              ? [...object.position]
              : field === 'rotation'
                ? [...object.rotation]
                : [...object.scale];
        inverse.push({ op: 'set', objectId: op.objectId, fence: op.fence, field, value });
      }
    }
    return inverse;
  }

  private async flush(): Promise<void> {
    if (this.sending || this.state.conflict !== null) return;
    const next = this.queue[0];
    if (!next) {
      if (this.state.saving) {
        this.patch({ saving: false });
        announce('save', saveStatusCopy.saved);
      }
      return;
    }
    this.sending = true;
    try {
      const response = await api<{ revision: number; stateHash: string }>(
        `/api/scenes/${this.sceneId}`,
        {
          method: 'PATCH',
          body: { baseRevision: next.baseRevision, changeId: next.changeId, ops: next.ops },
        },
      );
      this.queue.shift();
      this.patch({ revision: response.revision, stateHash: response.stateHash });
      if (this.queue.length === 0) {
        this.patch({ saving: false });
        announce('save', saveStatusCopy.saved);
      }
    } catch (error) {
      this.onSaveFailure(error, next);
    } finally {
      this.sending = false;
    }
    if (this.queue.length > 0 && this.state.conflict === null) void this.flush();
  }

  private onSaveFailure(error: unknown, change: PendingChange): void {
    if (!(error instanceof ApiFault)) {
      announce('save', saveStatusCopy.offline);
      return;
    }
    if (error.status === 412) {
      const details = error.details as { currentRevision?: number; conflicts?: string[] };
      announce('save', saveStatusCopy.revisionConflict);
      this.patch({
        conflict: {
          currentRevision: details.currentRevision ?? this.state.revision,
          conflicts: details.conflicts ?? [],
        },
      });
      return;
    }
    if (error.code === 'stale_lock') {
      const objectId = (error.details as { objectId?: string }).objectId ?? '';
      announce('save', saveStatusCopy.leaseLost(this.objectName(objectId)));
      this.queue = this.queue.filter((entry) => entry !== change);
      void this.reload(this.state.revision);
      return;
    }
    if (error.code === 'lock_store_unavailable') {
      announce('save', saveStatusCopy.lockOutage);
      return;
    }
    if (error.status === 403) {
      announce('save', saveStatusCopy.demoted);
      this.queue = [];
      return;
    }
    if (error.status === 422) {
      announce('save', saveStatusCopy.fieldError);
      this.queue = this.queue.filter((entry) => entry !== change);
      return;
    }
    if (error.status === 401) {
      toSignIn();
      return;
    }
    announce('save', saveStatusCopy.offline);
  }

  /** Keep my changes: reapply the queued changes on top of the newer revision. */
  async resolveConflict(choice: 'mine' | 'theirs'): Promise<void> {
    const pending = this.queue;
    this.queue = [];
    this.patch({ conflict: null });
    const response = await api<{ scene: SceneRecord; document: SceneDocument }>(
      `/api/scenes/${this.sceneId}`,
    );
    this.patch({
      scene: response.scene,
      document: response.document,
      revision: response.scene.revision,
      stateHash: response.scene.stateHash,
    });
    if (choice === 'theirs') {
      this.history = [];
      this.future = [];
      announce('save', saveStatusCopy.saved);
      return;
    }
    let document = response.document;
    for (const change of pending) {
      const ops = change.ops.filter((op) => {
        if (op.op === 'add' || op.op === 'scene') return true;
        return document.objects.some((object) => object.id === op.objectId);
      });
      if (ops.length === 0) continue;
      const fenced = ops.map((op) =>
        op.op === 'set' || op.op === 'remove'
          ? { ...op, fence: this.state.fence ?? op.fence }
          : op,
      );
      const applied = applyOps(document, fenced);
      if (!applied.ok) continue;
      document = applied.document;
      this.queue.push({
        changeId: uuid(),
        baseRevision: response.scene.revision,
        ops: fenced,
      });
    }
    this.patch({ document });
    if (this.queue.length > 0) {
      announce('save', saveStatusCopy.pending);
      void this.flush();
    } else {
      announce('save', saveStatusCopy.saved);
    }
  }

  /* ------------------------------------------------------ field state -- */

  markFieldError(key: string, invalid: boolean): void {
    if (invalid) {
      if (this.fieldErrors.size === 0) this.savedStatusBeforeError = saveStatusCopy.saved;
      this.fieldErrors.add(key);
      announce('save', saveStatusCopy.fieldError);
      return;
    }
    this.fieldErrors.delete(key);
    if (this.fieldErrors.size === 0 && this.savedStatusBeforeError !== null) {
      announce('save', this.savedStatusBeforeError);
      this.savedStatusBeforeError = null;
    }
  }

  /* ------------------------------------------------------------ edits -- */

  setParam(objectId: string, key: string, value: number): boolean {
    return this.commit([
      {
        op: 'set',
        objectId,
        fence: this.state.fence ?? 0,
        field: `params.${key}`,
        value,
      },
    ]);
  }

  setTransform(objectId: string, field: 'position' | 'rotation' | 'scale', value: number[]): boolean {
    return this.commit([
      { op: 'set', objectId, fence: this.state.fence ?? 0, field, value },
    ]);
  }

  rename(objectId: string, name: string): boolean {
    return this.commit([
      { op: 'set', objectId, fence: this.state.fence ?? 0, field: 'name', value: name },
    ]);
  }

  setSceneField(field: 'name' | 'gravity', value: string | number): boolean {
    return this.commit([{ op: 'scene', field, value }]);
  }

  remove(objectId: string): boolean {
    const done = this.commit([
      { op: 'remove', objectId, fence: this.state.fence ?? 0 },
    ]);
    if (done) this.patch({ selectedId: null, fence: null, lockHolder: null });
    return done;
  }

  addRig(kind: 'ramp' | 'pendulum' | 'launcher' | 'crate', position: Vec3): void {
    const document = this.state.document;
    if (!document) return;
    const object: SceneObject = {
      assetId: null,
      id: nextObjectId(document, kind, randomSuffix()),
      kind,
      name: nextObjectName(document, kind),
      params: defaultParams(kind),
      position,
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    if (this.commit([{ op: 'add', object }])) void this.select(object.id);
  }

  addModel(asset: { id: string; name: string; scaleToMetres: number | null }, position: Vec3): void {
    const document = this.state.document;
    if (!document) return;
    const baseName = asset.name.replace(/\.[^.]+$/, '');
    const object: SceneObject = {
      assetId: asset.id,
      id: nextObjectId(document, 'model', randomSuffix()),
      kind: 'model',
      name: document.objects.some((other) => other.name === baseName)
        ? `${baseName} ${document.objects.length + 1}`
        : baseName,
      params: {},
      position,
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    if (this.commit([{ op: 'add', object }])) void this.select(object.id);
  }

  undo(): void {
    const entry = this.history.pop();
    if (!entry) return;
    if (this.commit(entry.inverse, { history: false })) this.future.push(entry);
    else this.history.push(entry);
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    if (this.commit(entry.ops, { history: false })) this.history.push(entry);
    else this.future.push(entry);
  }

  /* -------------------------------------------------------------- run -- */

  startRun(): void {
    const document = this.state.document;
    if (!document) return;
    this.simulation = new Simulation(document);
    this.accumulator = 0;
    this.lastFrameAt = performance.now();
    this.lastTelemetryAt = 0;
    this.patch({ mode: 'running', step: 0, bodies: this.bodyMap() });
    this.frame(performance.now());
  }

  stopRun(): void {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.simulation = null;
    this.patch({
      mode: 'edit',
      step: 0,
      bodies: new Map(),
      stateHash: this.state.scene?.stateHash ?? this.state.stateHash,
      fps: 0,
      frameMs: 0,
    });
  }

  pauseRun(): void {
    if (this.state.mode === 'running') {
      if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
      this.patch({ mode: 'paused', ...this.telemetry() });
      return;
    }
    if (this.state.mode === 'paused') {
      this.lastFrameAt = performance.now();
      this.accumulator = 0;
      this.patch({ mode: 'running' });
      this.frame(performance.now());
    }
  }

  stepRun(): void {
    if (this.state.mode === 'edit') return;
    if (this.state.mode === 'running') {
      if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
      this.patch({ mode: 'paused' });
    }
    this.simulation?.advanceOne();
    this.patch({ bodies: this.bodyMap(), ...this.telemetry() });
  }

  private frame = (now: number): void => {
    if (!this.simulation || this.state.mode !== 'running') return;
    const elapsed = Math.min((now - this.lastFrameAt) / 1000, 0.25);
    this.lastFrameAt = now;
    this.accumulator += elapsed;
    const dt = STEP_SECONDS;
    let steps = 0;
    while (this.accumulator >= dt && steps < MAX_STEPS_PER_FRAME) {
      this.simulation.advanceOne();
      this.accumulator -= dt;
      steps += 1;
    }
    const frameMs = elapsed * 1000;
    const bodies = this.bodyMap();
    if (now - this.lastTelemetryAt > 500) {
      this.lastTelemetryAt = now;
      this.patch({
        bodies,
        fps: Math.round(1000 / Math.max(frameMs, 1)),
        frameMs: Math.round(frameMs * 10) / 10,
        ...this.telemetry(),
      });
    } else {
      this.patch({ bodies });
    }
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private telemetry(): { step: number; stateHash: string } {
    if (!this.simulation) return { step: 0, stateHash: this.state.stateHash };
    return { step: this.simulation.step, stateHash: this.simulation.stateHash() };
  }

  private bodyMap(): Map<string, Body> {
    const map = new Map<string, Body>();
    for (const body of this.simulation?.bodies() ?? []) map.set(body.id, body);
    return map;
  }
}

function cloneObject(object: SceneObject): SceneObject {
  return cloneDocument({ gravity: 1, name: '', objects: [object], solver: { iterations: 4, step: '1/120' } })
    .objects[0];
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

