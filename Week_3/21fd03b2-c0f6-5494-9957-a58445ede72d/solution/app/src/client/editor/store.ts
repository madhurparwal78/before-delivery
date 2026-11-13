import { COLLAB, COPY, SAVE, lockNotice } from "../../shared/copy";
import {
  applyOps,
  findObject,
  newObject,
  nextName,
  randomSuffix,
  type Op,
  type SceneDocument,
  type SceneObject,
} from "../../shared/doc";
import { KIND_LABEL, formatSi, parseParamEntry, rangeError, roundMillionth, POSITION_LIMIT, type ParamDef, type RigKind, type Vec3, type Vec4 } from "../../shared/params";
import { initialHash } from "../../shared/sim";
import { ApiFailure, isOffline, request, serverTime } from "../api";
import { notify } from "../notices";
import { loadModel, type LoadedModel } from "../stage/models";
import { Runner, type Telemetry } from "../stage/runner";
import type { SceneView, Tool, GizmoCommit } from "../stage/scene";

export type Role = "owner" | "editor" | "viewer";
export type PanelName = "outline" | "inspector" | "props" | "assets";

export interface Person {
  userId: string;
  displayName: string;
  cursor: [number, number, number] | null;
  selected: string | null;
  role: Role;
}
export interface LockEntry {
  objectId: string;
  holder: { userId: string; displayName: string };
  fence: number;
  expiresAt: string;
}
export interface Services {
  locks: "ok" | "down";
  storage: "ok" | "down";
  mail: "ok" | "down";
}
export interface AssetInfo {
  id: string;
  name: string;
  kind: "glb" | "gltf" | "png" | "jpeg";
  bytes: number;
  sha256: string;
  unit: string | null;
  scaleToMetres: number | null;
  extentMetres: number | null;
}
export interface CheckpointInfo {
  id: string;
  label: string;
  revision: number;
  stateHash: string;
  createdAt: string;
}
export interface LabInfo {
  token: string;
  url: string;
  bundleHash: string;
  publishedAt: string;
  checkpointId: string;
  exposed: string[];
}
export interface Draft {
  text: string;
  error: string | null;
  value: number | null;
}
export interface PanelState {
  open: boolean;
  maximised: boolean;
  x: number | null;
  y: number | null;
}

export interface EditorState {
  phase: "loading" | "ready" | "missing";
  user: { id: string; displayName: string };
  workspace: { id: string; name: string };
  projectId: string;
  projectName: string;
  role: Role;
  demoted: boolean;
  scene: { id: string; name: string; status: string; lab: LabInfo | null };
  doc: SceneDocument;
  revision: number;
  assets: AssetInfo[];
  modelsVersion: number;
  checkpoints: CheckpointInfo[];
  selection: string | null;
  holds: Record<string, number>;
  refusal: { objectId: string; holder: string } | null;
  people: Person[];
  locks: LockEntry[];
  services: Services;
  saveText: string;
  conflict: boolean;
  drafts: Record<string, Draft>;
  mode: "edit" | "run";
  paused: boolean;
  telemetry: Telemetry;
  tool: Tool;
  snap: boolean;
  grid: boolean;
  colliders: boolean;
  hidden: string[];
  pickLocked: string[];
  collab: string;
  panels: Record<PanelName, PanelState>;
  canUndo: boolean;
  canRedo: boolean;
  renaming: string | null;
  webgl: boolean;
  cameraTick: number;
  cursor: [number, number, number] | null;
  dialog: "commands" | "shortcuts" | "publish" | "share" | "restore" | null;
  restoreTarget: CheckpointInfo | null;
}

interface Change {
  changeId: string;
  ops: Op[];
  base: number;
}
interface HistoryEntry {
  forward: Op[];
  inverse: Op[];
}

const DEFAULT_PANELS: Record<PanelName, PanelState> = {
  outline: { open: true, maximised: false, x: null, y: null },
  inspector: { open: true, maximised: false, x: null, y: null },
  props: { open: true, maximised: false, x: null, y: null },
  assets: { open: true, maximised: false, x: null, y: null },
};

const COMMIT_DELAY_MS = 500;
const HOLD_MS = 260;
const PRESENCE_MS = 1000;
const STATUS_POLL_MS = 3000;
const RETRY_MS = 1000;
const NUDGE = 0.1;
const FINE = 0.01;
const SNAP_STEP = 0.25;

function newTabId(): string {
  return `tab-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

const uuid = (): string => crypto.randomUUID();
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The editor's state and every rule that turns user actions into saved revisions, leases and runs. */
export class EditorStore {
  state: EditorState;
  readonly models = new Map<string, LoadedModel>();
  readonly tab = newTabId();
  stage: SceneView | null = null;
  private listeners = new Set<() => void>();
  private serverDoc: SceneDocument;
  private known = 0;
  private queue: Change[] = [];
  private pumping = false;
  private pulling = false;
  private pullAgain = false;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private commitTimers = new Map<string, number>();
  private renewTimer = 0;
  private leaseTtlMs = 30000;
  private retryTimer = 0;
  private events: EventSource | null = null;
  private timers: number[] = [];
  readonly runner: Runner;
  private collabQueue: string[] = [];
  private collabTimer = 0;
  private presenceSeen = false;
  private presencePending = true;
  private disposed = false;

  constructor(
    readonly sceneId: string,
    readonly workspaceId: string,
  ) {
    this.runner = new Runner({
      doc: () => this.state.doc,
      overrides: () => ({}),
      bounds: this.boundsLookup,
      changed: (snapshot) => this.set({ mode: snapshot.running ? "run" : "edit", paused: snapshot.paused, telemetry: snapshot.telemetry }),
      poses: (poses) => this.stage?.setPoses(poses),
    });
    const blank: SceneDocument = { gravity: 9.81, name: "", objects: [], solver: { iterations: 4, step: "1/120" } };
    this.serverDoc = blank;
    this.state = {
      phase: "loading",
      user: { id: "", displayName: "" },
      workspace: { id: workspaceId, name: "" },
      projectId: "",
      projectName: "",
      role: "viewer",
      demoted: false,
      scene: { id: sceneId, name: "", status: "draft", lab: null },
      doc: blank,
      revision: 0,
      assets: [],
      modelsVersion: 0,
      checkpoints: [],
      selection: null,
      holds: {},
      refusal: null,
      people: [],
      locks: [],
      services: { locks: "ok", storage: "ok", mail: "ok" },
      saveText: SAVE.success,
      conflict: false,
      drafts: {},
      mode: "edit",
      paused: false,
      telemetry: { fps: 0, ms: 0, step: 0, hash: "" },
      tool: "move",
      snap: false,
      grid: true,
      colliders: false,
      hidden: [],
      pickLocked: [],
      collab: "",
      panels: copy(DEFAULT_PANELS),
      canUndo: false,
      canRedo: false,
      renaming: null,
      webgl: true,
      cameraTick: 0,
      cursor: null,
      dialog: null,
      restoreTarget: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): EditorState => this.state;

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------- derived rules

  get canEdit(): boolean {
    return (this.state.role === "owner" || this.state.role === "editor") && !this.state.demoted;
  }

  get editing(): boolean {
    return this.canEdit && this.state.services.locks === "ok" && this.state.mode === "edit" && !this.state.conflict;
  }

  /** Whether the selected object's fields accept edits (its lease is mine). */
  fieldsEditable(objectId: string | null): boolean {
    return this.editing && (objectId === null || this.state.holds[objectId] !== undefined);
  }

  displayedSave(): string {
    const s = this.state;
    if (s.demoted) return SAVE.demoted;
    if (s.services.locks === "down") return SAVE.lockOutage;
    if (Object.values(s.drafts).some((d) => d.error !== null)) return SAVE.fieldError;
    return s.saveText;
  }

  lockNoticeText(): string | null {
    const s = this.state;
    if (!s.selection || s.holds[s.selection] !== undefined) return null;
    const object = findObject(s.doc, s.selection);
    if (!object) return null;
    if (s.refusal && s.refusal.objectId === s.selection) return lockNotice(s.refusal.holder, object.name);
    const lock = s.locks.find((l) => l.objectId === s.selection);
    return lock ? lockNotice(lock.holder.displayName, object.name) : null;
  }

  boundsLookup = (assetId: string): import("../../shared/gltf").Bounds | null => this.models.get(assetId)?.bounds ?? null;

  // ---------------------------------------------------------------- loading

  async init(): Promise<void> {
    try {
      const [sceneAnswer, meAnswer] = await Promise.all([
        request<{ scene: { id: string; projectId: string; name: string; status: string; revision: number; lab: LabInfo | null }; document: SceneDocument }>(`/api/scenes/${this.sceneId}`),
        request<{ user: { id: string; displayName: string }; workspaces: Array<{ id: string; name: string; role: Role }> }>("/api/me"),
      ]);
      const workspace = meAnswer.data.workspaces.find((w) => w.id === this.workspaceId);
      if (!workspace) throw new ApiFailure(404, "not_found", "Not found");
      const { scene, document } = sceneAnswer.data;
      const [projectAnswer, checkpoints] = await Promise.all([
        request<{ project: { name: string }; assets: AssetInfo[] }>(`/api/projects/${scene.projectId}`),
        request<{ checkpoints: CheckpointInfo[] }>(`/api/scenes/${this.sceneId}/checkpoints`),
      ]);
      this.serverDoc = document;
      this.known = scene.revision;
      this.set({
        phase: "ready",
        user: meAnswer.data.user,
        workspace: { id: workspace.id, name: workspace.name },
        projectId: scene.projectId,
        projectName: projectAnswer.data.project.name,
        role: workspace.role,
        scene: { id: scene.id, name: scene.name, status: scene.status, lab: scene.lab },
        doc: document,
        revision: scene.revision,
        assets: projectAnswer.data.assets,
        checkpoints: checkpoints.data.checkpoints,
        telemetry: { fps: 0, ms: 0, step: 0, hash: initialHash(document) },
      });
      this.runner.refreshResting();
      void this.ensureModels();
      this.openLive();
      this.startTimers();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) this.set({ phase: "missing" });
      else if (!(error instanceof ApiFailure)) this.set({ phase: "missing" });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.events?.close();
    this.timers.forEach((t) => clearInterval(t));
    clearInterval(this.renewTimer);
    clearTimeout(this.retryTimer);
    this.commitTimers.forEach((t) => clearTimeout(t));
    void fetch(`/api/scenes/${this.sceneId}/presence?tab=${this.tab}`, { method: "DELETE", keepalive: true }).then((r) => r.text()).catch(() => undefined);
  }

  async ensureModels(): Promise<void> {
    const wanted = this.state.doc.objects.flatMap((o) => (o.assetId ? [o.assetId] : []));
    let changed = false;
    for (const id of new Set(wanted)) {
      if (this.models.has(id)) continue;
      const asset = this.state.assets.find((a) => a.id === id);
      if (!asset) continue;
      try {
        const response = await fetch(`/api/assets/${id}/original`, { credentials: "same-origin" });
        if (!response.ok) continue;
        const model = await loadModel(new Uint8Array(await response.arrayBuffer()));
        if (model) {
          this.models.set(id, model);
          changed = true;
        }
      } catch {
        /* the model stays out of the scene until storage returns */
      }
    }
    if (changed) this.set({ modelsVersion: this.state.modelsVersion + 1 });
  }

  async refreshAssets(): Promise<void> {
    const { data } = await request<{ assets: AssetInfo[] }>(`/api/projects/${this.state.projectId}`);
    this.set({ assets: data.assets });
    void this.ensureModels();
  }

  async refreshCheckpoints(): Promise<void> {
    const { data } = await request<{ checkpoints: CheckpointInfo[] }>(`/api/scenes/${this.sceneId}/checkpoints`);
    this.set({ checkpoints: data.checkpoints });
  }

  async refreshScene(): Promise<void> {
    const { data } = await request<{ scene: { name: string; status: string; lab: LabInfo | null } }>(`/api/scenes/${this.sceneId}`);
    this.set({ scene: { ...this.state.scene, name: data.scene.name, status: data.scene.status, lab: data.scene.lab } });
  }

  // ---------------------------------------------------------------- live channel, presence, timers

  private openLive(): void {
    const source = new EventSource(`/api/scenes/${this.sceneId}/live?tab=${this.tab}`);
    this.events = source;
    source.addEventListener("revision", (e) => {
      const { revision } = JSON.parse((e as MessageEvent<string>).data) as { revision: number };
      if (revision > this.known) void this.pull();
    });
    source.addEventListener("presence", (e) => this.onPresence(JSON.parse((e as MessageEvent<string>).data) as { people: Person[]; locks: LockEntry[] }));
    source.addEventListener("role", (e) => this.applyRole((JSON.parse((e as MessageEvent<string>).data) as { role: Role }).role));
    source.addEventListener("status", (e) => this.setServices(JSON.parse((e as MessageEvent<string>).data) as Services));
    source.addEventListener("open", () => {
      this.presencePending = true;
    });
  }

  private startTimers(): void {
    this.timers.push(
      window.setInterval(() => void this.sendPresence(), PRESENCE_MS),
      window.setInterval(() => void this.pollStatus(), STATUS_POLL_MS),
    );
    void this.sendPresence();
  }

  private async pollStatus(): Promise<void> {
    try {
      const { data } = await request<Services>("/api/status", { quiet: true });
      this.setServices(data);
    } catch {
      /* offline: the Save status already says so */
    }
  }

  private setServices(next: Services): void {
    const previous = this.state.services;
    if (previous.locks === next.locks && previous.storage === next.storage && previous.mail === next.mail) return;
    this.set({ services: next });
    if (previous.locks === "down" && next.locks === "ok") {
      this.presencePending = true;
      if (this.queue.length === 0) this.setSave(SAVE.success);
      void this.pump();
      if (this.state.selection) void this.acquire(this.state.selection);
    }
    if (next.locks === "down") this.dropHolds();
  }

  private dropHolds(): void {
    clearInterval(this.renewTimer);
    this.set({ holds: {}, refusal: null });
  }

  setCursor(point: [number, number, number] | null): void {
    this.set({ cursor: point });
    this.presencePending = true;
  }

  private async sendPresence(): Promise<void> {
    if (this.disposed || this.state.services.locks === "down" || !this.presencePending && !this.state.cursor) return;
    this.presencePending = false;
    try {
      await request(`/api/scenes/${this.sceneId}/presence`, { method: "PUT", body: { tab: this.tab, cursor: this.state.cursor, selected: this.state.selection }, quiet: true });
    } catch {
      this.presencePending = true;
    }
  }

  private onPresence(body: { people: Person[]; locks: LockEntry[] }): void {
    const previous = { people: this.state.people, locks: this.state.locks };
    if (this.presenceSeen) this.announceBatch(this.announcementsFor(previous, body));
    this.presenceSeen = true;
    this.set({ people: body.people, locks: body.locks });
    const selected = this.state.selection;
    if (selected && this.canEdit && this.state.holds[selected] === undefined && !body.locks.some((l) => l.objectId === selected)) {
      this.set({ refusal: null });
      void this.acquire(selected);
    }
  }

  private announcementsFor(before: { people: Person[]; locks: LockEntry[] }, after: { people: Person[]; locks: LockEntry[] }): string[] {
    const messages: string[] = [];
    const announce = (text: string): number => messages.push(text);
    const me = this.state.user.id;
    const nameOf = (id: string): string => findObject(this.state.doc, id)?.name ?? id;
    for (const p of after.people) {
      if (p.userId === me) continue;
      const old = before.people.find((o) => o.userId === p.userId);
      if (!old) announce(COLLAB.joined(p.displayName));
      else if (old.role !== p.role) announce(COLLAB.role(p.displayName, p.role === "viewer" ? "Viewer" : "Editor"));
    }
    for (const p of before.people) if (p.userId !== me && !after.people.some((o) => o.userId === p.userId)) announce(COLLAB.left(p.displayName));
    const objects = new Set([...before.locks, ...after.locks].map((l) => l.objectId));
    for (const objectId of objects) {
      const was = before.locks.find((l) => l.objectId === objectId)?.holder;
      const now = after.locks.find((l) => l.objectId === objectId)?.holder;
      if (was && was.userId !== me && was.userId !== now?.userId) announce(COLLAB.free(nameOf(objectId)));
      if (now && now.userId !== me && now.userId !== was?.userId) announce(COLLAB.editing(now.displayName, nameOf(objectId)));
    }
    return messages;
  }

  /**
   * One change in the room can produce several messages (someone left and their object is free). They are shown one
   * after another, each for a moment; a message from a later change replaces whatever is showing.
   */
  private announceBatch(messages: string[]): void {
    if (messages.length === 0) return;
    window.clearTimeout(this.collabTimer);
    this.collabQueue = messages.slice(1);
    this.set({ collab: messages[0] });
    if (this.collabQueue.length > 0) this.collabTimer = window.setTimeout(() => this.nextAnnouncement(), HOLD_MS);
  }

  private nextAnnouncement(): void {
    const text = this.collabQueue.shift();
    if (text === undefined) return;
    this.set({ collab: text });
    if (this.collabQueue.length > 0) this.collabTimer = window.setTimeout(() => this.nextAnnouncement(), HOLD_MS);
  }

  // ---------------------------------------------------------------- roles

  applyRole(role: Role): void {
    const was = this.state.role;
    if (role === was && !this.state.demoted) return;
    const wasEditor = was === "owner" || was === "editor";
    if (role === "viewer" && wasEditor) {
      this.queue = [];
      this.dropHolds();
      this.undoStack = [];
      this.redoStack = [];
      this.set({ role, demoted: true, doc: this.serverDoc, drafts: {}, renaming: null, canUndo: false, canRedo: false });
      return;
    }
    if (role !== "viewer") {
      this.set({ role, demoted: false });
      this.setSave(SAVE.success);
      if (this.state.selection) void this.acquire(this.state.selection);
      return;
    }
    this.set({ role });
  }

  // ---------------------------------------------------------------- selection and leases

  select(id: string | null): void {
    const previous = this.state.selection;
    if (previous === id) return;
    if (previous && this.state.holds[previous] !== undefined) this.releaseLease(previous);
    this.set({ selection: id, refusal: null, renaming: null });
    this.presencePending = true;
    void this.sendPresence();
    if (id && this.canEdit && this.state.services.locks === "ok" && this.state.mode === "edit") void this.acquire(id);
  }

  async acquire(objectId: string): Promise<boolean> {
    if (!this.canEdit || findObject(this.state.doc, objectId) === undefined) return false;
    try {
      const { data, response } = await request<{ lock: LockEntry }>(`/api/scenes/${this.sceneId}/locks/${objectId}`, { method: "POST", body: { tab: this.tab } });
      if (this.state.selection !== objectId) {
        void request(`/api/scenes/${this.sceneId}/locks/${objectId}`, { method: "DELETE", quiet: true }).catch(() => undefined);
        return false;
      }
      this.leaseTtlMs = Math.max(Date.parse(data.lock.expiresAt) - serverTime(response), 3000);
      this.set({ holds: { ...this.state.holds, [objectId]: data.lock.fence }, refusal: null });
      this.startRenewing(objectId);
      return true;
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "lock_held") {
        const holder = (error.details.holder as { displayName: string } | undefined)?.displayName ?? "Someone";
        this.set({ refusal: { objectId, holder } });
      } else if (error instanceof ApiFailure && error.code === "lock_store_unavailable") {
        this.setServices({ ...this.state.services, locks: "down" });
      } else if (error instanceof ApiFailure && error.status === 403) {
        this.applyRole("viewer");
      }
      return false;
    }
  }

  private startRenewing(objectId: string): void {
    clearInterval(this.renewTimer);
    this.renewTimer = window.setInterval(() => void this.renew(objectId), Math.max(this.leaseTtlMs / 3, 1000));
  }

  private async renew(objectId: string): Promise<void> {
    if (this.state.selection !== objectId || this.state.holds[objectId] === undefined) return;
    try {
      const { data } = await request<{ lock: LockEntry }>(`/api/scenes/${this.sceneId}/locks/${objectId}`, { method: "POST", body: { tab: this.tab } });
      if (data.lock.fence !== this.state.holds[objectId]) this.set({ holds: { ...this.state.holds, [objectId]: data.lock.fence } });
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "lock_held") {
        const { [objectId]: _gone, ...rest } = this.state.holds;
        this.set({ holds: rest, refusal: { objectId, holder: (error.details.holder as { displayName: string }).displayName } });
        const name = findObject(this.state.doc, objectId)?.name ?? objectId;
        if (this.queue.length > 0) this.setSave(SAVE.leaseLost(name));
      }
    }
  }

  private releaseLease(objectId: string): void {
    clearInterval(this.renewTimer);
    const { [objectId]: _released, ...rest } = this.state.holds;
    this.set({ holds: rest });
    void request(`/api/scenes/${this.sceneId}/locks/${objectId}`, { method: "DELETE", quiet: true }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- changes and autosave

  private setSave(text: string): void {
    this.set({ saveText: text });
  }

  private fenceFor(op: Op): Op {
    if (op.op !== "set" && op.op !== "remove") return op;
    const held = this.state.holds[op.objectId];
    return held === undefined ? op : { ...op, fence: held };
  }

  /** One change: applied to the local view at once, queued, saved in order. */
  commit(forward: Op[], inverse: Op[], history = true): void {
    if (forward.length === 0) return;
    const doc = applyOps(this.state.doc, forward);
    this.queue.push({ changeId: uuid(), ops: forward.map((o) => this.fenceFor(o)), base: Math.max(this.known, this.state.revision) });
    if (history) {
      this.undoStack.push({ forward, inverse });
      this.redoStack = [];
    }
    const selection = this.state.selection && findObject(doc, this.state.selection) ? this.state.selection : null;
    if (selection !== this.state.selection) {
      this.set({ doc, selection, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
      this.dropHolds();
    } else this.set({ doc, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
    this.setSave(SAVE.pending);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && !this.state.conflict && this.canEdit && this.state.services.locks === "ok") {
        const change = this.queue[0];
        change.base = Math.max(change.base, this.state.revision);
        this.set({ saveText: SAVE.pending });
        try {
          const { data } = await request<{ revision: number }>(`/api/scenes/${this.sceneId}`, {
            method: "PATCH",
            body: { baseRevision: change.base, changeId: change.changeId, ops: change.ops.map((o) => this.fenceFor(o)) },
          });
          this.queue.shift();
          this.serverDoc = applyOps(this.serverDoc, change.ops);
          this.known = Math.max(this.known, data.revision);
          this.set({ revision: Math.max(this.state.revision, data.revision) });
          if (this.queue.length === 0) this.setSave(SAVE.success);
        } catch (error) {
          if (!(await this.onSaveFailure(error))) return;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Returns true when the loop may continue with the next change. */
  private async onSaveFailure(error: unknown): Promise<boolean> {
    if (isOffline(error) || (error instanceof ApiFailure && error.status >= 500 && error.code !== "lock_store_unavailable")) {
      this.setSave(SAVE.offline);
      clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => void this.pump(), RETRY_MS);
      return false;
    }
    if (!(error instanceof ApiFailure)) return false;
    if (error.status === 412) {
      this.setSave(SAVE.conflict);
      this.set({ conflict: true });
      return false;
    }
    if (error.code === "lock_store_unavailable") {
      this.setServices({ ...this.state.services, locks: "down" });
      return false;
    }
    if (error.status === 403) {
      this.applyRole("viewer");
      return false;
    }
    this.queue.shift();
    if (error.code === "stale_lock") {
      const id = (error.details.objectId as string | undefined) ?? "";
      const name = findObject(this.state.doc, id)?.name ?? id;
      this.setSave(SAVE.leaseLost(name));
    } else if (error.status === 422) this.setSave(SAVE.fieldError);
    else this.setSave(SAVE.success);
    await this.pull(true);
    return true;
  }

  async pull(force = false): Promise<void> {
    if (this.pulling) {
      this.pullAgain = true;
      return;
    }
    this.pulling = true;
    try {
      const response = await fetch(`/api/scenes/${this.sceneId}/document`, { credentials: "same-origin" });
      if (response.status === 401) location.reload();
      if (!response.ok) return;
      const revision = Number(response.headers.get("x-revision"));
      const parsed = JSON.parse(await response.text()) as SceneDocument;
      if (!force && revision <= this.known) return;
      this.serverDoc = parsed;
      this.known = Math.max(this.known, revision);
      this.rebase(revision);
    } catch {
      /* the next revision event retries */
    } finally {
      this.pulling = false;
      if (this.pullAgain) {
        this.pullAgain = false;
        void this.pull();
      }
    }
  }

  private rebase(revision: number): void {
    const doc = applyOps(this.serverDoc, this.queue.flatMap((c) => c.ops));
    const selection = this.state.selection && findObject(doc, this.state.selection) ? this.state.selection : null;
    if (selection !== this.state.selection) this.dropHolds();
    this.set({ doc, revision: Math.max(this.state.revision, revision), selection, scene: { ...this.state.scene, name: doc.name } });
    if (this.state.mode === "edit") this.runner.refreshResting();
    void this.ensureModels();
    void this.refreshAssetsIfUnknown(doc);
  }

  private async refreshAssetsIfUnknown(doc: SceneDocument): Promise<void> {
    if (doc.objects.some((o) => o.assetId && !this.state.assets.some((a) => a.id === o.assetId))) await this.refreshAssets();
  }

  async keepMine(): Promise<void> {
    const response = await fetch(`/api/scenes/${this.sceneId}/document`, { credentials: "same-origin" });
    const revision = Number(response.headers.get("x-revision"));
    this.serverDoc = JSON.parse(await response.text()) as SceneDocument;
    this.known = Math.max(this.known, revision);
    this.queue = this.queue
      .map((c) => ({ ...c, base: revision, ops: c.ops.filter((op) => (op.op !== "set" && op.op !== "remove") || findObject(this.serverDoc, op.objectId) !== undefined) }))
      .filter((c) => c.ops.length > 0);
    this.set({ conflict: false });
    this.rebase(revision);
    this.setSave(this.queue.length > 0 ? SAVE.pending : SAVE.success);
    void this.pump();
  }

  async useTheirs(): Promise<void> {
    this.queue = [];
    this.undoStack = [];
    this.redoStack = [];
    const response = await fetch(`/api/scenes/${this.sceneId}/document`, { credentials: "same-origin" });
    const revision = Number(response.headers.get("x-revision"));
    this.serverDoc = JSON.parse(await response.text()) as SceneDocument;
    this.known = Math.max(this.known, revision);
    this.set({ conflict: false, drafts: {}, canUndo: false, canRedo: false });
    this.rebase(revision);
    this.setSave(SAVE.success);
  }

  // ---------------------------------------------------------------- field drafts

  private clearDraft(key: string): void {
    window.clearTimeout(this.commitTimers.get(key));
    this.commitTimers.delete(key);
    if (this.state.drafts[key] === undefined) return;
    const { [key]: _gone, ...rest } = this.state.drafts;
    this.set({ drafts: rest });
  }

  /** Typing: parse on every keystroke; commit once valid and half a second quiet. */
  typeInto(key: string, text: string, def: ParamDef, apply: (value: number) => void): void {
    const entry = parseParamEntry(text, def);
    const error = entry.ok ? null : def.key.startsWith("position") && entry.error === rangeError(def) ? COPY.transform : entry.error;
    this.set({ drafts: { ...this.state.drafts, [key]: { text, error, value: entry.ok ? entry.si : null } } });
    window.clearTimeout(this.commitTimers.get(key));
    if (entry.ok) this.commitTimers.set(key, window.setTimeout(() => this.settleDraft(key, apply), COMMIT_DELAY_MS));
  }

  settleDraft(key: string, apply: (value: number) => void): void {
    const draft = this.state.drafts[key];
    if (!draft) return;
    window.clearTimeout(this.commitTimers.get(key));
    if (draft.error !== null || draft.value === null) return;
    this.clearDraft(key);
    apply(draft.value);
  }

  discardDraft(key: string): void {
    this.clearDraft(key);
  }

  setParam(objectId: string, key: string, value: number): void {
    const object = findObject(this.state.doc, objectId);
    if (!object || formatSi(object.params[key]) === formatSi(value)) return;
    this.commit([{ op: "set", objectId, fence: 0, field: `params.${key}`, value }], [{ op: "set", objectId, fence: 0, field: `params.${key}`, value: object.params[key] }]);
  }

  setPositionAxis(objectId: string, axis: number, value: number): void {
    const object = findObject(this.state.doc, objectId);
    if (!object || Math.abs(value) > POSITION_LIMIT) return;
    const next = [...object.position] as Vec3;
    next[axis] = roundMillionth(value);
    this.setTransform(objectId, "position", next);
  }

  setTransform(objectId: string, field: "position" | "rotation" | "scale", value: Vec3 | Vec4): void {
    const object = findObject(this.state.doc, objectId);
    if (!object || JSON.stringify(object[field]) === JSON.stringify(value)) return;
    this.commit([{ op: "set", objectId, fence: 0, field, value }], [{ op: "set", objectId, fence: 0, field, value: object[field] }]);
  }

  setGravity(value: number): void {
    if (this.state.doc.gravity === value) return;
    this.commit([{ op: "scene", field: "gravity", value }], [{ op: "scene", field: "gravity", value: this.state.doc.gravity }]);
  }

  setSceneName(name: string): void {
    const trimmed = name.trim();
    if (trimmed === this.state.doc.name || [...trimmed].length < 1 || [...trimmed].length > 60) return;
    this.commit([{ op: "scene", field: "name", value: trimmed }], [{ op: "scene", field: "name", value: this.state.doc.name }]);
  }

  rename(objectId: string, name: string): void {
    const object = findObject(this.state.doc, objectId);
    const trimmed = name.trim();
    this.set({ renaming: null });
    if (!object || trimmed === object.name || [...trimmed].length < 1 || [...trimmed].length > 60) return;
    this.commit([{ op: "set", objectId, fence: 0, field: "name", value: trimmed }], [{ op: "set", objectId, fence: 0, field: "name", value: object.name }]);
  }

  startRename(objectId: string | null): void {
    if (objectId && this.editing) this.set({ renaming: objectId });
  }

  cancelRename(): void {
    this.set({ renaming: null });
  }

  // ---------------------------------------------------------------- stage editing

  nudge(axis: "x" | "y" | "z", direction: 1 | -1, fine: boolean): void {
    const id = this.state.selection;
    if (!id || !this.fieldsEditable(id)) return;
    const object = findObject(this.state.doc, id);
    if (!object) return;
    const { tool, snap } = this.state;
    if (tool === "move") {
      const index = { x: 0, y: 1, z: 2 }[axis];
      const step = snap ? SNAP_STEP : fine ? FINE : NUDGE;
      let value = object.position[index] + direction * step;
      if (snap) value = Math.round(value / SNAP_STEP) * SNAP_STEP;
      this.setPositionAxis(id, index, value);
    } else if (tool === "rotate" && axis === "x") {
      const degrees = snap ? 15 : 5;
      const half = (direction * degrees * Math.PI) / 360;
      const [x, y, z, w] = object.rotation;
      const s = Math.sin(half);
      const c = Math.cos(half);
      const q: Vec4 = [c * x + s * z, c * y + s * w, c * z - s * x, c * w - s * y];
      this.setTransform(id, "rotation", q.map((n) => roundMillionth(n)) as Vec4);
    } else if (tool === "scale" && axis === "z") {
      const factor = object.scale[0] - direction * NUDGE;
      const clamped = roundMillionth(Math.min(100, Math.max(0.01, factor)));
      this.setTransform(id, "scale", [clamped, clamped, clamped]);
    }
  }

  applyGizmo(commit: GizmoCommit): void {
    if (commit.position) this.setTransform(commit.objectId, "position", commit.position);
    if (commit.rotation) this.setTransform(commit.objectId, "rotation", commit.rotation);
    if (commit.scale) this.setTransform(commit.objectId, "scale", commit.scale);
  }

  removeSelected(): void {
    const id = this.state.selection;
    if (!id || !this.fieldsEditable(id)) return;
    const object = findObject(this.state.doc, id);
    if (!object) return;
    this.commit([{ op: "remove", objectId: id, fence: 0 }], [{ op: "add", object: copy(object) }]);
  }

  place(spec: { kind: RigKind } | { asset: AssetInfo }, position?: Vec3): void {
    if (!this.editing) return;
    const doc = this.state.doc;
    let object: SceneObject;
    if ("kind" in spec) {
      const id = `${spec.kind}-${randomSuffix()}`;
      const at: Vec3 = position ?? [0, 0, 0];
      object = newObject(spec.kind, id, nextName(doc.objects, KIND_LABEL[spec.kind]), at);
    } else {
      const scale = spec.asset.scaleToMetres ?? 1;
      const model = this.models.get(spec.asset.id);
      const lift = model ? -model.bounds.min[1] * scale : 0;
      const at: Vec3 = position ?? [0, 0, 0];
      object = {
        assetId: spec.asset.id,
        id: `model-${randomSuffix()}`,
        kind: "model",
        name: spec.asset.name.replace(/\.[^.]+$/, ""),
        params: {},
        position: [at[0], roundMillionth(lift), at[2]],
        rotation: [0, 0, 0, 1],
        scale: [scale, scale, scale],
      };
    }
    this.commit([{ op: "add", object }], [{ op: "remove", objectId: object.id, fence: 0 }]);
    this.select(object.id);
  }

  async undo(): Promise<void> {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry || !(await this.prepareHistory(entry.inverse))) return;
    this.undoStack.pop();
    this.redoStack.push(entry);
    this.commit(entry.inverse, entry.forward, false);
    this.set({ canUndo: this.undoStack.length > 0, canRedo: true });
  }

  async redo(): Promise<void> {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry || !(await this.prepareHistory(entry.forward))) return;
    this.redoStack.pop();
    this.undoStack.push(entry);
    this.commit(entry.forward, entry.inverse, false);
    this.set({ canUndo: true, canRedo: this.redoStack.length > 0 });
  }

  /** History applies as ordinary changes, so it needs the lease on each object it touches. */
  private async prepareHistory(ops: Op[]): Promise<boolean> {
    if (!this.editing) return false;
    for (const op of ops) {
      if (op.op !== "set" && op.op !== "remove") continue;
      if (this.state.holds[op.objectId] !== undefined) continue;
      if (findObject(this.state.doc, op.objectId) === undefined) return false;
      this.select(op.objectId);
      if (!(await this.acquire(op.objectId))) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- run

  canRun(): boolean {
    return this.state.webgl && this.state.phase === "ready" && this.state.doc.objects.every((o) => o.kind !== "model" || !o.assetId || this.models.has(o.assetId));
  }

  startRun(): void {
    if (this.state.mode === "run" || !this.canRun()) return;
    this.set({ renaming: null });
    this.runner.start();
    this.stage?.requestRender();
  }

  stopRun(): void {
    this.runner.stop();
  }

  togglePause(): void {
    this.runner.togglePause();
  }

  stepOnce(): void {
    this.runner.stepOnce();
  }

  /** The full state hash at the current step (the telemetry card shows its first 12 characters). */
  fullHash(): string {
    return this.runner.fullHash();
  }

  // ---------------------------------------------------------------- toggles

  setTool(tool: Tool): void {
    this.set({ tool });
  }
  toggleSnap(): void {
    this.set({ snap: !this.state.snap });
  }
  toggleGrid(): void {
    this.set({ grid: !this.state.grid });
  }
  toggleColliders(): void {
    this.set({ colliders: !this.state.colliders });
  }
  toggleHidden(id: string): void {
    const hidden = this.state.hidden.includes(id) ? this.state.hidden.filter((h) => h !== id) : [...this.state.hidden, id];
    this.set({ hidden });
  }
  togglePickLock(id: string): void {
    this.set({ pickLocked: this.state.pickLocked.includes(id) ? this.state.pickLocked.filter((h) => h !== id) : [...this.state.pickLocked, id] });
  }
  setPanel(name: PanelName, patch: Partial<PanelState>): void {
    this.set({ panels: { ...this.state.panels, [name]: { ...this.state.panels[name], ...patch } } });
  }
  resetLayout(): void {
    this.set({ panels: copy(DEFAULT_PANELS) });
  }
  setWebgl(ok: boolean): void {
    if (this.state.webgl !== ok) this.set({ webgl: ok });
  }
  bumpCamera(): void {
    this.set({ cameraTick: this.state.cameraTick + 1 });
  }
  setSceneMeta(patch: Partial<EditorState["scene"]>): void {
    this.set({ scene: { ...this.state.scene, ...patch } });
  }
  setCheckpoints(checkpoints: CheckpointInfo[]): void {
    this.set({ checkpoints });
  }
  announceSave(text: string): void {
    this.setSave(text);
  }

  openDialog(dialog: NonNullable<EditorState["dialog"]>): void {
    this.set({ dialog });
  }

  closeDialog(): void {
    this.set({ dialog: null, restoreTarget: null });
  }

  askRestore(checkpoint: CheckpointInfo): void {
    this.set({ dialog: "restore", restoreTarget: checkpoint });
  }

  async confirmRestore(): Promise<void> {
    const target = this.state.restoreTarget;
    if (!target) return;
    this.closeDialog();
    try {
      await request(`/api/scenes/${this.sceneId}/checkpoints/${target.id}/restore`, { method: "POST", body: {} });
      await this.afterRestore(target.label);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "locks_held") this.setSave(SAVE.restoreRefused);
      else if (error instanceof ApiFailure && error.code === "storage_unavailable") notify("File storage is unreachable. Uploads, checkpoints and publishing are paused.");
      else if (error instanceof ApiFailure && error.code === "lock_store_unavailable") this.setServices({ ...this.state.services, locks: "down" });
    }
  }

  /** After a restore: show the restored scene and drop anything pending. */
  async afterRestore(label: string): Promise<void> {
    this.queue = [];
    await this.pull(true);
    this.setSave(SAVE.restored(label));
  }
}
