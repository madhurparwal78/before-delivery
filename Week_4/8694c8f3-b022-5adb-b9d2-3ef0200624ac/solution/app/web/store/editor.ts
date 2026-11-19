import { HEARTBEAT_SECONDS } from "../../shared/collab.ts";
import { KIND_LABELS, readLayerValue } from "../../shared/layers.ts";
import { applyOp, Invalid, needsBaseVersion, resolveTarget, TargetMissing, versionOf } from "../../shared/ops.ts";
import type { OpEnv } from "../../shared/ops.ts";
import type { Fields } from "../../shared/schema.ts";
import type {
  AssetDoc, GraphDoc, LayerDoc, LayerKind, LockDoc, LockEvent, OpDocument, OpInput, Person, PresenceMember, ScriptDoc, ServiceStatus,
  SetDocument, ShowListing,
} from "../../shared/types.ts";
import { api, ApiFailure } from "../api.ts";
import { Transport } from "../engine/clock.ts";
import { ScriptHost } from "../engine/scripts.ts";
import type { EffectiveLayer } from "../engine/evaluate.ts";
import type { CompileResult, GizmoMode } from "../engine/renderer.ts";
import type { StageSource } from "../engine/stage-source.ts";
import { prefersReducedMotion } from "../engine/stage-controller.ts";
import { animateDemo } from "./demo.ts";
import { uuid } from "../ids.ts";

type AutosaveText = "Saved" | "Saving" | "Waiting to sync" | "Save failed";

interface PendingOp {
  id: string;
  op: OpInput;
  base: number | undefined;
}

export interface Conflict {
  item: PendingOp;
  current: unknown;
  currentVersion: number;
  changedBy: string;
  targetName: string;
}

interface CommitOutcome {
  ok: boolean;
  fields: Fields;
}

const CONSOLE_LIMIT = 400;
const RETRY_MS = 1000;

function trustedEnv(): OpEnv {
  return { trusted: true, assets: new Map(), shaderSource: () => undefined };
}

export class EditorStore implements StageSource {
  readonly mode: "demo" | "live";
  readonly setId: string;
  readonly user: Person;
  readonly transport = new Transport();
  readonly scripts: ScriptHost;
  doc: SetDocument;
  changeCount = 0;
  selection: string | null = null;
  assets: AssetDoc[] = [];
  locks = new Map<string, LockDoc>();
  presence: PresenceMember[] = [];
  services: Pick<ServiceStatus, "storage" | "collab"> = { storage: "ok", collab: "ok" };
  offline = false;
  notice = "";
  conflict: Conflict | null = null;
  consoleLines: string[] = [];
  scriptStatus = "";
  fieldErrors = new Map<string, string>();
  shaderChanges = 0;
  assetStatus = "";
  showStatus = "";
  exportStatus = "";
  shows: ShowListing | null = null;
  rejected = false;
  gizmoMode: GizmoMode = "move";
  gridSnap = false;
  angleSnap = false;
  scrubbing: { layerId: string; path: string } | null = null;
  readonly editorChrome = true;
  readonly bus = null;
  readonly animate: ((beat: number, effective: Map<string, EffectiveLayer>) => void) | null;
  frameVersion = 0;
  shaderStatus = "";
  shaderErrors = new Set<number>();
  readonly drafts = new Map<string, string>();
  selectedScript: string | null = null;
  compiler: ((source: string) => CompileResult | null) | null = null;
  private readonly shaderCache = new Map<string, string>();
  private readonly shaderFetches = new Set<string>();
  private readonly frameListeners = new Set<() => void>();
  private head: number;
  private pending: PendingOp[] = [];
  private inFlight = false;
  private flushing = false;
  private paused = false;
  private wasOffline = false;
  private catching = false;
  private catchAgain = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ownIds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly drawListeners = new Set<() => void>();
  private stream: EventSource | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private assetsTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private constructor(mode: "demo" | "live", doc: SetDocument, user: Person) {
    this.mode = mode;
    this.doc = doc;
    this.setId = doc.set.id;
    this.user = user;
    this.head = doc.set.head;
    this.transport.setBpm(doc.set.bpm);
    this.animate = mode === "demo" ? animateDemo : null;
    this.scripts = new ScriptHost({
      console: (line) => this.log(line),
      problem: (line) => {
        this.scriptStatus = line;
        this.changed();
      },
      nodesChanged: () => this.changed(),
    });
    this.scripts.sync(doc.scripts);
    this.transport.subscribe(() => this.changed());
  }

  static demo(doc: SetDocument, user: Person): EditorStore {
    return new EditorStore("demo", doc, user);
  }

  static async open(setId: string, user: Person): Promise<EditorStore> {
    const doc = await api.set(setId);
    const store = new EditorStore("live", doc, user);
    store.restoreQueue();
    await store.refreshAssets();
    await store.refreshCollab();
    store.connect();
    return store;
  }

  get role(): SetDocument["set"]["role"] {
    return this.doc.set.role;
  }

  get canEdit(): boolean {
    return this.role !== "viewer";
  }

  get queued(): number {
    return this.pending.length;
  }

  get autosave(): AutosaveText {
    if (this.rejected) return "Save failed";
    if (this.pending.length > 0 && this.offline) return "Waiting to sync";
    return this.pending.length > 0 || this.inFlight ? "Saving" : "Saved";
  }

  get selected(): LayerDoc | undefined {
    return this.doc.layers.find((layer) => layer.id === this.selection);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onDraw(listener: () => void): () => void {
    this.drawListeners.add(listener);
    return () => this.drawListeners.delete(listener);
  }

  getChangeCount = (): number => this.changeCount;

  requestDraw(): void {
    for (const listener of this.drawListeners) listener();
  }

  subscribeFrames = (listener: () => void): (() => void) => {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  };

  getFrameVersion = (): number => this.frameVersion;

  frameDone(): void {
    this.frameVersion += 1;
    for (const listener of this.frameListeners) listener();
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.changed();
    this.requestDraw();
  }

  toggleSnap(which: "grid" | "angle"): void {
    if (which === "grid") this.gridSnap = !this.gridSnap;
    else this.angleSnap = !this.angleSnap;
    this.changed();
  }

  beginScrub(layerId: string, path: string): void {
    this.scrubbing = { layerId, path };
    if (!prefersReducedMotion()) this.requestDraw();
  }

  endScrub(): void {
    this.scrubbing = null;
  }

  /** The text of a shader layer's saved version, fetched once; the stage asks again when it arrives. */
  shaderText(layerId: string, version: number): string | undefined {
    const key = `${layerId}:${version}`;
    const cached = this.shaderCache.get(key);
    if (cached !== undefined || this.mode === "demo" || this.shaderFetches.has(key)) return cached;
    this.shaderFetches.add(key);
    void api.shaderSource(this.setId, layerId, version).then(
      (found) => {
        this.shaderCache.set(key, found.source);
        this.requestDraw();
      },
      () => this.shaderFetches.delete(key),
    );
    return undefined;
  }

  selectScript(id: string | null): void {
    this.selectedScript = id;
    this.changed();
  }

  setDraft(id: string, value: string | null): void {
    if (value === null) this.drafts.delete(id);
    else this.drafts.set(id, value);
    this.changed();
  }

  /** Compiles a GLSL text in the browser and reports the first error the way the Shader compile region reads it. */
  compileShader(source: string): void {
    this.shaderStatus = "Compiling";
    this.shaderErrors = new Set();
    this.changed();
    queueMicrotask(() => {
      const result = this.compiler?.(source) ?? null;
      if (result === null || result.ok) {
        this.shaderStatus = "Compiled";
      } else {
        const first = result.problems[0];
        this.shaderStatus = first ? `Line ${first.line}: ${first.message}` : "Compiled";
        this.shaderErrors = new Set(result.problems.map((problem) => problem.line));
      }
      this.changed();
    });
  }

  rememberShader(layerId: string, version: number, source: string): void {
    this.shaderCache.set(`${layerId}:${version}`, source);
  }

  private changed(): void {
    this.changeCount += 1;
    for (const listener of this.listeners) listener();
  }

  private log(line: string): void {
    this.consoleLines = [...this.consoleLines, line].slice(-CONSOLE_LIMIT);
    this.changed();
  }

  announce(text: string): void {
    this.notice = text;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = "";
      this.changed();
    }, 8000);
    this.changed();
  }

  // ---- selection, locks, presence ------------------------------------------------------------

  select(id: string | null): void {
    if (id === this.selection) return;
    const previous = this.selection;
    this.selection = id;
    if (previous && this.heldByMe(previous)) void this.releaseLock(previous);
    if (this.mode === "live") void this.postPresence();
    this.changed();
    this.requestDraw();
  }

  heldByMe(layerId: string): boolean {
    return this.locks.get(layerId)?.holder.user_id === this.user.user_id;
  }

  async takeLock(layerId: string): Promise<void> {
    try {
      const lock = await api.takeLock(this.setId, layerId);
      this.locks.set(layerId, { layer_id: layerId, holder: lock.holder, expires_at: lock.expires_at });
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "lock_held") {
        this.announce(`Locked by ${error.detail.holder?.display_name ?? "someone"}`);
        if (error.detail.holder && error.detail.expires_at) {
          this.locks.set(layerId, { layer_id: layerId, holder: error.detail.holder, expires_at: error.detail.expires_at });
        }
      } else if (!(error instanceof ApiFailure)) {
        throw error;
      }
    }
    this.changed();
  }

  async releaseLock(layerId: string): Promise<void> {
    try {
      await api.releaseLock(this.setId, layerId);
      this.locks.delete(layerId);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === "lock_not_held") this.locks.delete(layerId);
    }
    this.changed();
  }

  private async postPresence(): Promise<void> {
    if (!this.canEdit) return;
    try {
      this.presence = (await api.postPresence(this.setId, this.selection)).members;
      this.changed();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
  }

  private async refreshCollab(): Promise<void> {
    try {
      this.locks = new Map((await api.locks(this.setId)).locks.map((lock) => [lock.layer_id, lock]));
      this.presence = (await api.presence(this.setId)).members;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
    this.changed();
  }

  private async keepAlive(): Promise<void> {
    const mine = [...this.locks.values()].find((lock) => lock.holder.user_id === this.user.user_id);
    if (mine) {
      try {
        const renewed = await api.heartbeat(this.setId, mine.layer_id);
        this.locks.set(mine.layer_id, { ...mine, expires_at: renewed.expires_at });
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "lock_not_held") {
          this.locks.delete(mine.layer_id);
          this.changed();
        }
      }
    }
    if (this.canEdit && this.services.collab === "ok") await this.postPresence();
    else if (this.services.collab === "ok") await this.refreshCollab();
  }

  // ---- event stream and catching up -----------------------------------------------------------

  private connect(): void {
    this.openStream();
    this.timers.push(setInterval(() => void this.keepAlive(), HEARTBEAT_SECONDS * 1000));
    this.timers.push(setInterval(() => void this.pollStatus(), 3000));
    this.timers.push(setInterval(() => void this.pollOps(), 2000));
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    void this.pollStatus();
    if (!navigator.onLine) this.setOffline(true);
    if (this.pending.length > 0) void this.flush();
  }

  private openStream(): void {
    this.stream?.close();
    const stream = new EventSource(`/api/sets/${this.setId}/events?after=${this.head}`);
    this.stream = stream;
    stream.addEventListener("op", (event) => this.receive(JSON.parse((event as MessageEvent<string>).data) as OpDocument));
    stream.addEventListener("lock", (event) => this.onLock(JSON.parse((event as MessageEvent<string>).data) as LockEvent));
    stream.addEventListener("presence", (event) => {
      this.presence = (JSON.parse((event as MessageEvent<string>).data) as { members: PresenceMember[] }).members;
      this.changed();
    });
    stream.addEventListener("status", (event) => this.onStatus(JSON.parse((event as MessageEvent<string>).data) as ServiceStatus));
    stream.addEventListener("show", () => void this.refreshShows());
  }

  private readonly onOnline = (): void => {
    void this.reconnect();
  };

  private readonly onOffline = (): void => this.setOffline(true);

  private onStatus(status: ServiceStatus): void {
    this.services = { storage: status.storage, collab: status.collab };
    this.changed();
  }

  private async pollStatus(): Promise<void> {
    try {
      this.onStatus(await api.status());
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
  }

  private async pollOps(): Promise<void> {
    if (this.services.collab === "unreachable" && !this.offline) await this.catchUp();
  }

  private onLock(event: LockEvent): void {
    const previous = this.locks.get(event.layer_id);
    if (event.holder && event.expires_at) {
      this.locks.set(event.layer_id, { layer_id: event.layer_id, holder: event.holder, expires_at: event.expires_at });
    } else {
      this.locks.delete(event.layer_id);
      if (event.reason === "expired" && previous?.holder.user_id === this.user.user_id) {
        const name = this.doc.layers.find((layer) => layer.id === event.layer_id)?.name ?? "layer";
        this.announce(`Your lock on ${name} expired`);
      }
    }
    this.changed();
  }

  async catchUp(): Promise<void> {
    if (this.catching) {
      this.catchAgain = true;
      return;
    }
    this.catching = true;
    try {
      do {
        this.catchAgain = false;
        const { ops } = await api.opsAfter(this.setId, this.head);
        for (const op of ops) this.receive(op);
      } while (this.catchAgain);
    } catch (error) {
      if (error instanceof ApiFailure && error.network) this.setOffline(true);
      else if (!(error instanceof ApiFailure)) throw error;
    } finally {
      this.catching = false;
    }
  }

  private receive(op: OpDocument): void {
    if (op.seq <= this.head) return;
    if (op.seq > this.head + 1) {
      void this.catchUp();
      return;
    }
    this.head = op.seq;
    if (this.ownIds.has(op.client_op_id)) return;
    try {
      this.applyRemote(op);
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
      void this.reload();
    }
  }

  private applyRemote(op: OpDocument): void {
    const input: OpInput = { type: op.type, target: op.target, payload: op.payload };
    const effects = applyOp(this.doc, input, trustedEnv());
    if (effects.layersRemoved.includes(this.selection ?? "")) this.selection = null;
    for (const id of effects.freedLocks) this.locks.delete(id);
    if (op.type.startsWith("script.")) this.scripts.sync(this.doc.scripts);
    if (op.type.startsWith("shader.")) this.shaderChanges += 1;
    if (op.type === "set.update") this.transport.setBpm(this.doc.set.bpm);
    if (/^(layer\.(set|remove)|script\.(save|remove))/.test(op.type)) this.scheduleAssets();
    this.changed();
    this.requestDraw();
  }

  private scheduleAssets(): void {
    if (this.assetsTimer) clearTimeout(this.assetsTimer);
    this.assetsTimer = setTimeout(() => void this.refreshAssets(), 250);
  }

  /** Replaces the whole document with the server's copy after a refused or unreadable change. */
  async reload(): Promise<void> {
    try {
      const fresh = await api.set(this.setId);
      this.doc = fresh;
      this.head = fresh.set.head;
      this.transport.setBpm(fresh.set.bpm);
      this.scripts.sync(fresh.scripts);
      if (this.selection && !fresh.layers.some((layer) => layer.id === this.selection)) this.selection = null;
      this.shaderChanges += 1;
      this.changed();
      this.requestDraw();
    } catch (error) {
      if (error instanceof ApiFailure && error.network) this.setOffline(true);
      else if (!(error instanceof ApiFailure)) throw error;
    }
  }

  // ---- committing ops ----------------------------------------------------------------------------

  private env(): OpEnv {
    return {
      assets: new Map(this.assets.map((asset) => [asset.id, { kind: asset.kind, status: asset.status }])),
      shaderSource: () => undefined,
    };
  }

  /** Applies an op to the working copy at once and queues it for the server. */
  commit(op: OpInput): CommitOutcome {
    if (!this.canEdit) return { ok: false, fields: {} };
    const target = resolveTarget(this.doc, op);
    const base = needsBaseVersion(op.type) && target ? versionOf(this.doc, target) : undefined;
    try {
      applyOp(this.doc, op, this.mode === "live" ? this.env() : trustedEnv());
    } catch (error) {
      if (error instanceof Invalid) {
        this.rejected = true;
        const [field, message] = Object.entries(error.fields)[0] ?? ["value", error.message];
        this.fieldErrors.set(`${op.target}:${field}`, message);
        this.changed();
        return { ok: false, fields: error.fields };
      }
      if (error instanceof TargetMissing) return { ok: false, fields: {} };
      throw error;
    }
    this.rejected = false;
    for (const key of [...this.fieldErrors.keys()]) if (key.startsWith(`${op.target}:`)) this.fieldErrors.delete(key);
    if (op.type === "set.update") this.transport.setBpm(this.doc.set.bpm);
    if (op.type.startsWith("script.")) this.scripts.sync(this.doc.scripts);
    if (op.type.startsWith("shader.")) this.shaderChanges += 1;
    if (this.selection && !this.doc.layers.some((layer) => layer.id === this.selection)) this.selection = null;
    if (this.mode === "live") {
      const id = `op-${uuid()}`;
      this.ownIds.add(id);
      this.pending.push({ id, op, base });
      this.persistQueue();
      void this.flush();
    }
    this.changed();
    this.requestDraw();
    return { ok: true, fields: {} };
  }

  /** Moves a value on the working copy without logging an op; used while a drag is under way. */
  preview(layerId: string, path: string, value: number): void {
    const layer = this.doc.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    const version = layer.version;
    try {
      applyOp(this.doc, { type: "layer.set", target: layerId, payload: { path, value } }, trustedEnv());
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
    }
    layer.version = version;
    this.changed();
    if (!(this.scrubbing && prefersReducedMotion())) this.requestDraw();
  }

  setLayerValue(layerId: string, path: string, value: unknown): CommitOutcome {
    return this.commit({ type: "layer.set", target: layerId, payload: { path, value } });
  }

  valueOf(layerId: string, path: string): number | undefined {
    const layer = this.doc.layers.find((candidate) => candidate.id === layerId);
    return layer ? readLayerValue(layer, path) : undefined;
  }

  addLayer(kind: LayerKind): void {
    const parent = this.selected?.kind === "group" ? this.selected.id : null;
    const siblings = this.doc.layers.filter((layer) => layer.parent_id === parent).length;
    const label = KIND_LABELS[kind];
    const taken = new Set(this.doc.layers.map((layer) => layer.name));
    let name = label;
    for (let n = 2; taken.has(name); n += 1) name = `${label} ${n}`;
    const id = uuid();
    const outcome = this.commit({ type: "layer.add", target: id, payload: { parent_id: parent, index: siblings, name, kind } });
    if (outcome.ok) this.select(id);
  }

  removeLayer(layerId: string): void {
    this.commit({ type: "layer.remove", target: layerId, payload: {} });
  }

  moveLayer(layerId: string, parentId: string | null, index: number): CommitOutcome {
    return this.commit({ type: "layer.reparent", target: layerId, payload: { parent_id: parentId, index } });
  }

  saveShader(layerId: string, source: string): void {
    const outcome = this.commit({ type: "shader.save", target: layerId, payload: { source } });
    const layer = this.doc.layers.find((candidate) => candidate.id === layerId);
    if (outcome.ok && layer?.shader_version != null) this.rememberShader(layerId, layer.shader_version, source);
    this.requestDraw();
  }

  restoreShader(layerId: string, fromVersion: number): void {
    this.commit({ type: "shader.restore", target: layerId, payload: { from_version: fromVersion } });
  }

  saveScript(script: ScriptDoc, source: string, assetIds: string[]): void {
    this.commit({ type: "script.save", target: script.id, payload: { source, asset_ids: assetIds } });
  }

  // ---- sending -------------------------------------------------------------------------------------

  private queueKey(): string {
    return `afterglass.queue.${this.setId}.${this.user.user_id}`;
  }

  private persistQueue(): void {
    try {
      if (this.pending.length === 0) localStorage.removeItem(this.queueKey());
      else localStorage.setItem(this.queueKey(), JSON.stringify(this.pending));
    } catch {
      return;
    }
  }

  private restoreQueue(): void {
    try {
      const raw = localStorage.getItem(this.queueKey());
      const stored: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(stored)) return;
      for (const item of stored as PendingOp[]) {
        try {
          applyOp(this.doc, item.op, trustedEnv());
          this.ownIds.add(item.id);
          this.pending.push(item);
        } catch (error) {
          if (!(error instanceof Invalid)) throw error;
        }
      }
    } catch {
      this.pending = [];
    }
  }

  private setOffline(value: boolean): void {
    if (value) {
      if (!this.offline) {
        this.offline = true;
        this.wasOffline = true;
        this.changed();
      }
      this.scheduleRetry();
    } else if (this.offline) {
      this.offline = false;
      this.changed();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.reconnect();
    }, RETRY_MS);
  }

  private async reconnect(): Promise<void> {
    if (!navigator.onLine) {
      this.scheduleRetry();
      return;
    }
    try {
      await api.status();
    } catch (error) {
      if (error instanceof ApiFailure && error.network) {
        this.scheduleRetry();
        return;
      }
    }
    this.offline = false;
    this.openStream();
    await this.flush();
    await this.catchUp();
    await this.refreshCollab();
    this.settle();
  }

  private settle(): void {
    if (this.pending.length === 0 && !this.offline && this.wasOffline && !this.conflict) {
      this.wasOffline = false;
      this.announce("Back online. All changes synced.");
    }
    this.changed();
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.paused) return;
    this.flushing = true;
    try {
      while (this.pending.length > 0 && !this.paused) {
        const item = this.pending[0];
        if (!item) break;
        if (!navigator.onLine) {
          this.setOffline(true);
          return;
        }
        this.inFlight = true;
        this.changed();
        const outcome = await this.send(item);
        this.inFlight = false;
        if (outcome === "retry") return;
        if (outcome === "done" || outcome === "dropped") {
          this.pending = this.pending.filter((candidate) => candidate !== item);
          this.persistQueue();
        }
        if (outcome === "paused") return;
      }
    } finally {
      this.flushing = false;
      this.inFlight = false;
      this.settle();
    }
  }

  private async send(item: PendingOp): Promise<"done" | "retry" | "paused" | "dropped"> {
    try {
      const result = await api.sendOp(this.setId, item.id, item.base, item.op);
      this.offline = false;
      const target = resolveTarget(this.doc, item.op);
      if (target?.kind === "layer" && target.layer.version < result.version) target.layer.version = result.version;
      if (result.seq === this.head + 1) this.head = result.seq;
      else if (result.seq > this.head) void this.catchUp();
      if (/^(layer\.(set|remove)|script\.(save|remove))/.test(item.op.type)) this.scheduleAssets();
      if (item.op.type.startsWith("shader.")) {
        this.shaderChanges += 1;
        this.changed();
      }
      return "done";
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      return this.refused(item, error);
    }
  }

  private async refused(item: PendingOp, error: ApiFailure): Promise<"retry" | "paused" | "dropped"> {
    if (error.network || error.status >= 500) {
      this.setOffline(true);
      return "retry";
    }
    if (error.code === "stale_version") {
      const current = error.detail.current;
      const name = typeof current === "object" && current !== null && "name" in current && typeof current.name === "string" ? current.name : "this";
      this.conflict = {
        item, current, currentVersion: error.detail.current_version ?? 0,
        changedBy: error.detail.changed_by?.display_name ?? "Someone", targetName: name,
      };
      this.paused = true;
      this.changed();
      return "paused";
    }
    if (error.code === "layer_locked") {
      this.announce(`This layer is locked by ${error.detail.holder?.display_name ?? "someone"}`);
      if (error.detail.holder && error.detail.expires_at) {
        this.locks.set(item.op.target, { layer_id: item.op.target, holder: error.detail.holder, expires_at: error.detail.expires_at });
      }
    } else if (error.status === 422) {
      this.rejected = true;
      const [field, message] = Object.entries(error.detail.fields ?? {})[0] ?? ["value", error.message];
      this.fieldErrors.set(`${item.op.target}:${field}`, message);
    }
    this.pending = this.pending.filter((candidate) => candidate.op.target !== item.op.target || candidate === item);
    await this.reload();
    return "dropped";
  }

  resolveConflict(choice: "keep" | "reapply"): void {
    const conflict = this.conflict;
    if (!conflict) return;
    const { item } = conflict;
    this.adopt(item.op, conflict.current, conflict.currentVersion);
    if (choice === "keep") {
      this.pending = this.pending.filter((candidate) => candidate.op.target !== item.op.target);
    } else {
      applyOp(this.doc, item.op, trustedEnv());
      const shift = conflict.currentVersion - (item.base ?? conflict.currentVersion);
      const replacement: PendingOp = { id: `op-${uuid()}`, op: item.op, base: conflict.currentVersion };
      this.ownIds.add(replacement.id);
      this.pending = this.pending.map((candidate) => {
        if (candidate === item) return replacement;
        return candidate.op.target === item.op.target && candidate.base !== undefined ? { ...candidate, base: candidate.base + shift } : candidate;
      });
    }
    this.conflict = null;
    this.paused = false;
    this.persistQueue();
    this.changed();
    this.requestDraw();
    void this.flush();
  }

  private adopt(op: OpInput, current: unknown, version: number): void {
    const state = current as Record<string, unknown>;
    if (op.target === "set") {
      this.doc.set = { ...this.doc.set, name: String(state["name"]), bpm: Number(state["bpm"]), settings_version: version };
      this.doc.set.active_camera_id = (state["active_camera_id"] as string | null) ?? null;
      this.transport.setBpm(this.doc.set.bpm);
    } else if (op.target === "graph") {
      const graph = current as GraphDoc;
      this.doc.graph = { version, nodes: graph.nodes, wires: graph.wires };
    } else if (op.type.startsWith("script.")) {
      this.doc.scripts = this.doc.scripts.map((script) => (script.id === op.target ? (current as ScriptDoc) : script));
      this.scripts.sync(this.doc.scripts);
    } else {
      this.doc.layers = this.doc.layers.map((layer) => (layer.id === op.target ? (current as LayerDoc) : layer));
    }
  }

  // ---- assets, shows, exports ----------------------------------------------------------------------

  async refreshAssets(): Promise<void> {
    if (this.mode !== "live") return;
    try {
      this.assets = (await api.assets(this.setId)).assets;
      this.changed();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
  }

  async refreshShows(): Promise<void> {
    try {
      this.shows = await api.shows(this.setId);
      this.changed();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
  }

  async uploadAsset(file: File): Promise<void> {
    this.assetStatus = `Uploading ${file.name}`;
    this.changed();
    const kind = /\.glb$/i.test(file.name) ? "model" : "texture";
    try {
      const { asset } = await api.uploadAsset(this.setId, kind, file);
      this.assetStatus = `${asset.name} is ready`;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      const failed = error.detail.asset;
      this.assetStatus = failed ? `${failed.name} upload failed` : `${file.name} upload failed`;
    }
    await this.refreshAssets();
  }

  async deleteAsset(asset: AssetDoc): Promise<ApiFailure | null> {
    try {
      await api.deleteAsset(this.setId, asset.id);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      return error;
    }
    await this.refreshAssets();
    return null;
  }

  async publish(): Promise<void> {
    const live = this.shows?.live_number ?? null;
    const next = Math.max(0, ...(this.shows?.versions.map((version) => version.number) ?? [])) + 1;
    this.showStatus = `Publishing version ${next}`;
    this.changed();
    try {
      const { show_version: version } = await api.publish(this.setId);
      this.showStatus = `Version ${version.number} is live`;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      this.showStatus = live === null ? "Publish failed. Nothing is live yet." : `Publish failed. Version ${live} is still live.`;
    }
    await this.refreshShows();
  }

  async rollback(): Promise<void> {
    try {
      const result = await api.rollback(this.setId);
      this.showStatus = `Rolled back. Version ${result.live_number} is live`;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      this.showStatus = error.message;
    }
    await this.refreshShows();
  }

  async activate(number: number): Promise<void> {
    try {
      const result = await api.activate(this.setId, number);
      this.showStatus = `Version ${result.live_number} is live`;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      this.showStatus = error.message;
    }
    await this.refreshShows();
  }

  async exportSet(): Promise<{ download_url: string; sha256: string } | null> {
    this.exportStatus = "Preparing export";
    this.changed();
    try {
      const { export: made } = await api.exportSet(this.setId);
      this.exportStatus = "Export ready";
      this.changed();
      return made;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      this.exportStatus = error.message;
      this.changed();
      return null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stream?.close();
    for (const timer of this.timers) clearInterval(timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    this.scripts.dispose();
    if (this.mode === "live" && this.selection && this.heldByMe(this.selection)) void this.releaseLock(this.selection);
  }
}
