// The editor's state: the operation log and playhead, selection, locks, presence, pending values and the
// server conversations behind them. Components subscribe and re-render on every change.
import type { Asset, Author, BatchResult, Comment, Lock, Op, Presence, Version } from "../../shared/api-types.js";
import { localTime } from "../../shared/format.js";
import { REST_STATE, TRANSFORM_RANGES, applyOperation, isRecord, resolvedNode, type Graph, type LayerType, type Operation, type SceneNode, type TransformField, type Vec3 } from "../../shared/graph.js";
import { undoStacks } from "../../shared/undo.js";
import { ApiError, del, get, post, randomHex, request } from "../api.js";
import { prefersReducedMotion } from "../ui.js";
import { READ_ONLY_COPY } from "../pages/shell.js";
import type { SceneView } from "../three/view.js";
import { announcement, changeList } from "./changes.js";
import { OpLog } from "./oplog.js";

export const AXES = ["X", "Y", "Z"] as const;
export const FIELD_LABEL: Record<TransformField, string> = { position: "Position", rotation: "Rotation", scale: "Scale" };
export const NUDGE: Record<TransformField, [number, number]> = { position: [0.1, 1], rotation: [1, 15], scale: [0.01, 0.1] };
const HIGHLIGHT_MS = 420;
const COUNT_MS = 240;
const ROLLBACK_MS = 160;
const REJECTED_MS = 2000;
const HEARTBEAT_MS = 10_000;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const isAuthor = (value: unknown): value is Author =>
  isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && (value.kind === "member" || value.kind === "agent" || value.kind === "system");
const round4 = (n: number) => Number(n.toFixed(4));

interface LockPrompt { nodeId: string; holder: Author; send: () => Promise<void>; restore: () => void; field: HTMLElement | null }
export interface ReviewLink { id: string; versionId: string; expiresAt: string; status: "active" | "expired" | "revoked"; token?: string }
export type Tab = "hierarchy" | "inspector" | "comments" | "versions";

interface Tween { from: Map<string, number>; to: Map<string, number>; start: number; duration: number }

export class EditorModel {
  log: OpLog;
  name = "";
  playhead = 0;
  selection: string | null = null;
  stateId = REST_STATE;
  locks = new Map<string, Author>();
  presence: Presence[] = [];
  comments: Comment[] = [];
  versions: Version[] = [];
  links: ReviewLink[] = [];
  assets: Asset[] = [];
  exports = new Map<string, string>();
  status = "";
  uploadStatus = "";
  rewindText = "";
  changes: string[] = [];
  highlighted: string[] = [];
  pending = new Map<string, number>();
  rejected = new Set<string>();
  display = new Map<string, number>();
  lockPrompt: LockPrompt | null = null;
  focusLayer: string | null = null;
  focusThread: string | null = null;
  sheetOpen = false;
  tab: Tab = "hierarchy";
  busy = new Set<string>();
  view: SceneView | null = null;
  viewport: HTMLElement | null = null;
  private listeners = new Set<() => void>();
  private highlightTimer = 0;
  private tween: Tween | null = null;
  private tweenFrame = 0;
  private events: EventSource | null = null;
  private heartbeat = 0;

  constructor(readonly sceneId: string, readonly me: Author, readonly timeZone: string, readonly canEdit: boolean, base: Graph, ops: Op[]) {
    this.log = new OpLog(base, ops);
    this.playhead = this.log.latestSeq;
    this.rewindText = announcement(this.log, this.playhead, timeZone);
  }

  static async load(sceneId: string, me: Author, timeZone: string, canEdit: boolean): Promise<EditorModel> {
    const page = (after: number) => get<{ ops: Op[] }>(`/api/scenes/${sceneId}/ops?after=${after}&limit=1000`);
    const [scene, base, first] = await Promise.all([
      get<{ name: string; latestSeq: number }>(`/api/scenes/${sceneId}`),
      get<{ graph: Graph }>(`/api/scenes/${sceneId}/graph?at=0`),
      page(0),
    ]);
    const ops: Op[] = [...first.ops];
    while (ops.length < scene.latestSeq) {
      const next = await page(ops.length);
      if (next.ops.length === 0) break;
      ops.push(...next.ops);
    }
    const model = new EditorModel(sceneId, me, timeZone, canEdit, base.graph, ops);
    model.name = scene.name;
    await Promise.all([model.loadLocks(), model.loadComments(), model.loadVersions(), model.loadAssets()]);
    return model;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  // --- Reads ---------------------------------------------------------------------------------------------------

  get latestSeq(): number { return this.log.latestSeq; }
  get atLatest(): boolean { return this.playhead === this.log.latestSeq; }
  get graph(): Graph { return this.log.at(this.log.latestSeq).graph; }
  get shown(): { graph: Graph; hash: string } { return this.log.at(this.playhead); }
  isMe(author: Author): boolean { return author.kind === this.me.kind && author.id === this.me.id; }
  heldByMe(nodeId: string): boolean { const holder = this.locks.get(nodeId); return holder !== undefined && this.isMe(holder); }
  nodeName(id: string): string {
    const found = this.graph.nodes.find((n) => n.id === id) ?? this.shown.graph.nodes.find((n) => n.id === id);
    if (found) return found.name;
    for (const op of this.log.all()) {
      const payload = op.payload;
      if (op.type === "node.add" && "node" in payload && payload.node.id === id) return payload.node.name;
    }
    return id;
  }
  isBusy(action: string): boolean { return this.busy.has(action); }

  /** The selected node's transform values as the inspector shows them: tweening, pending, or from the shown graph. */
  fieldValue(node: SceneNode, field: TransformField, axis: number): number {
    const key = `${node.id}:${field}:${axis}`;
    return this.display.get(key) ?? this.pending.get(key) ?? resolvedNode(this.shown.graph, node, this.stateId)[field][axis];
  }

  // --- Viewport ------------------------------------------------------------------------------------------------

  attachView(view: SceneView | null, viewport: HTMLElement): void {
    this.view = view;
    this.viewport = viewport;
    view?.setGraph(this.shown.graph, this.stateId);
    view?.frame();
    this.drawShown([]);
  }

  /** Redraws the viewport for the playhead before returning, and writes its instruments. */
  private drawShown(highlight: string[]): void {
    const { graph, hash } = this.shown;
    if (this.view) {
      this.view.setGraph(graph, this.stateId);
      this.view.setHighlight(highlight);
      this.view.setSelection(this.selection);
      this.view.renderNow();
    }
    if (this.viewport) {
      this.viewport.dataset.opSeq = String(this.playhead);
      this.viewport.dataset.graphHash = hash;
      this.viewport.dataset.highlighted = highlight.join(",");
    }
  }

  // --- Playhead and rewind -------------------------------------------------------------------------------------

  /** Moves the playhead: redraw, outline what changed, count the inspector, fade later ticks; settle announces. */
  moveTo(seq: number, settle: boolean): void {
    const target = Math.max(0, Math.min(this.log.latestSeq, Math.round(seq)));
    const previous = this.playhead;
    if (target !== previous) {
      const before = this.log.at(previous).graph, after = this.log.at(target).graph;
      const changed = [...new Set([...before.nodes, ...after.nodes].map((n) => n.id))].filter((id) => {
        const a = before.nodes.find((n) => n.id === id), b = after.nodes.find((n) => n.id === id);
        return JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(before.states.map((s) => s.overrides.filter((o) => o.nodeId === id)))
          !== JSON.stringify(after.states.map((s) => s.overrides.filter((o) => o.nodeId === id)));
      });
      const counted = this.selection ? this.transformSnapshot(this.selection, before) : null;
      this.playhead = target;
      this.highlighted = changed;
      this.drawShown(changed);
      window.clearTimeout(this.highlightTimer);
      this.highlightTimer = window.setTimeout(() => {
        this.highlighted = [];
        this.view?.setHighlight([]);
        this.view?.renderNow();
        if (this.viewport) this.viewport.dataset.highlighted = "";
        this.emit();
      }, HIGHLIGHT_MS);
      if (counted && this.selection) this.startTween(counted, this.transformSnapshot(this.selection, after), prefersReducedMotion() ? 0 : COUNT_MS);
      if (prefersReducedMotion()) this.changes = changeList(this.log, previous, target);
    }
    if (settle) this.rewindText = announcement(this.log, this.playhead, this.timeZone);
    this.emit();
  }

  private transformSnapshot(nodeId: string, graph: Graph): Map<string, number> {
    const values = new Map<string, number>();
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return values;
    const r = resolvedNode(graph, node, this.stateId);
    for (const field of ["position", "rotation", "scale"] as const) r[field].forEach((v, i) => values.set(`${nodeId}:${field}:${i}`, v));
    return values;
  }

  private startTween(from: Map<string, number>, to: Map<string, number>, duration: number): void {
    cancelAnimationFrame(this.tweenFrame);
    if (duration <= 0) { this.tween = null; this.display.clear(); this.emit(); return; }
    this.tween = { from, to, start: performance.now(), duration };
    const step = () => {
      const tween = this.tween;
      if (!tween) return;
      const t = Math.min(1, (performance.now() - tween.start) / tween.duration);
      this.display.clear();
      if (t < 1) {
        for (const [key, end] of tween.to) {
          const start = tween.from.get(key) ?? end;
          this.display.set(key, round4(start + (end - start) * easeOut(t)));
        }
        this.tweenFrame = requestAnimationFrame(step);
      } else this.tween = null;
      this.emit();
    };
    this.tweenFrame = requestAnimationFrame(step);
  }

  returnToLatest(): void { this.moveTo(this.log.latestSeq, true); }

  // --- Operations ----------------------------------------------------------------------------------------------

  /** Brings in operations the server has that this log lacks, keeping the playhead where it was unless it followed. */
  async refreshOps(): Promise<void> {
    const following = this.atLatest;
    const page = await get<{ ops: Op[] }>(`/api/scenes/${this.sceneId}/ops?after=${this.log.latestSeq}&limit=1000`);
    this.receive(page.ops, following);
  }

  private receive(ops: Op[], following: boolean): void {
    if (!this.log.append(ops)) { void this.refreshOps(); return; }
    if (following) this.playhead = this.log.latestSeq;
    this.drawShown(this.highlighted);
    this.emit();
  }

  private async send(ops: Operation[]): Promise<BatchResult> {
    const result = await post<BatchResult>(`/api/scenes/${this.sceneId}/ops`, { ops });
    await this.refreshOps();
    return result;
  }

  private async runAction(action: string, work: () => Promise<void>): Promise<void> {
    this.busy.add(action);
    this.emit();
    try { await work(); } finally { this.busy.delete(action); this.emit(); }
  }

  /** Commits a value: shown at once and marked pending; a refusal returns it to the server's value with a reason. */
  commitTransform(node: SceneNode, field: TransformField, axis: number, value: number, input: HTMLElement | null): void {
    if (!this.atLatest || !this.canEdit) return;
    const key = `${node.id}:${field}:${axis}`;
    const serverValue = resolvedNode(this.graph, node, this.stateId)[field][axis];
    const vector: Vec3 = [...resolvedNode(this.graph, node, this.stateId)[field]];
    vector[axis] = round4(value);
    const stateId = this.stateId;
    const op: Operation = stateId === REST_STATE
      ? { type: "transform.set", payload: { id: node.id, [field]: vector } }
      : { type: "state.override.set", payload: { stateId, nodeId: node.id, field, value: vector } };
    const label = `${FIELD_LABEL[field]} ${AXES[axis]}`;
    const range = TRANSFORM_RANGES[field];
    this.pending.set(key, round4(value));
    this.emit();
    this.guardedSend(node.id, input, () => this.optimistic(key, round4(value), serverValue, () => this.send([op]), (error) => {
      if (error.status === 422) return `${label} must be between ${range[0]} and ${range[1]}.`;
      return null;
    }), () => this.rollback(key, round4(value), serverValue));
  }

  commitLayer(nodeId: string, layerId: string, change: { color?: Vec3; roughness?: number; metalness?: number }, input: HTMLElement | null): void {
    if (!this.atLatest || !this.canEdit) return;
    this.guardedSend(nodeId, input, async () => {
      try { await this.send([{ type: "material.layer.set", payload: { id: nodeId, layerId, ...change } }]); }
      catch (error) { this.explain(error, nodeId); }
    }, () => this.emit());
  }

  addLayer(nodeId: string, type: LayerType): void {
    if (!this.atLatest || !this.canEdit) return;
    const layerId = `l_${randomHex(8)}`;
    const color: Vec3 = type === "emission" ? [1, 0.55, 0.3] : type === "sheen" ? [0.95, 0.9, 0.85] : [0.82, 0.8, 0.76];
    const layer = { id: layerId, type, color, roughness: type === "clearcoat" ? 0.1 : 0.5, metalness: 0 };
    this.guardedSend(nodeId, null, async () => {
      try {
        await this.send([{ type: "material.layer.add", payload: { id: nodeId, layer } }]);
        this.focusLayer = layerId;
        this.emit();
      } catch (error) { this.explain(error, nodeId); }
    }, () => this.emit());
  }

  removeLayer(nodeId: string, layerId: string): void {
    this.guardedSend(nodeId, null, async () => {
      try { await this.send([{ type: "material.layer.remove", payload: { id: nodeId, layerId } }]); }
      catch (error) { this.explain(error, nodeId); }
    }, () => this.emit());
  }

  /** A change to a node shown as held by another author opens the takeover prompt instead of sending. */
  private guardedSend(nodeId: string, field: HTMLElement | null, send: () => Promise<void>, restore: () => void): void {
    const holder = this.locks.get(nodeId);
    if (holder && !this.isMe(holder)) {
      this.lockPrompt = { nodeId, holder, send, restore, field };
      this.emit();
      return;
    }
    void send();
  }

  private async optimistic(key: string, value: number, serverValue: number, send: () => Promise<unknown>, reason: (e: ApiError) => string | null): Promise<void> {
    this.pending.set(key, value);
    this.emit();
    try {
      await send();
      this.pending.delete(key);
      this.emit();
    } catch (error) {
      this.rollback(key, value, serverValue);
      const nodeId = key.split(":")[0];
      this.status = (error instanceof ApiError ? reason(error) : null) ?? this.explain(error, nodeId);
      this.emit();
    }
  }

  /** The value visibly returns to the server's value; the field's edge turns vermilion for about two seconds. */
  private rollback(key: string, attempted: number, serverValue: number): void {
    this.pending.delete(key);
    this.rejected.add(key);
    window.setTimeout(() => { this.rejected.delete(key); this.emit(); }, REJECTED_MS);
    this.startTween(new Map([[key, attempted]]), new Map([[key, serverValue]]), prefersReducedMotion() ? 0 : ROLLBACK_MS);
    this.emit();
  }

  /** The editor-status copy for a refused change; a lock conflict also marks the node as held. */
  private explain(error: unknown, nodeId: string): string {
    let text = "The change could not be saved.";
    if (error instanceof ApiError) {
      const author = error.body.holder;
      if (error.code === "locked" && isAuthor(author)) {
        const lockedNode = typeof error.body.nodeId === "string" ? error.body.nodeId : nodeId;
        this.locks.set(lockedNode, author);
        text = `Change to ${this.nodeName(lockedNode)} rolled back: ${author.name} is editing it.`;
      } else if (error.code === "workspace_read_only") text = READ_ONLY_COPY.dunning;
    }
    this.status = text;
    this.emit();
    return text;
  }

  // --- Locks and takeover --------------------------------------------------------------------------------------

  async loadLocks(): Promise<void> {
    const { locks } = await get<{ locks: Lock[] }>(`/api/scenes/${this.sceneId}/locks`);
    this.locks = new Map(locks.map((l) => [l.nodeId, l.holder]));
  }

  async select(nodeId: string | null): Promise<void> {
    const previous = this.selection;
    this.selection = nodeId;
    this.view?.setSelection(nodeId);
    this.view?.renderNow();
    this.emit();
    void this.beat();
    if (!this.canEdit || previous === nodeId) return;
    if (previous && this.heldByMe(previous)) {
      this.locks.delete(previous);
      await del(`/api/scenes/${this.sceneId}/locks/${encodeURIComponent(previous)}`).catch(() => undefined);
    }
    if (!nodeId) return;
    try {
      const { lock } = await post<{ lock: Lock }>(`/api/scenes/${this.sceneId}/locks`, { nodeId });
      this.locks.set(nodeId, lock.holder);
    } catch (error) {
      if (error instanceof ApiError && error.code === "locked" && isAuthor(error.body.holder)) this.locks.set(nodeId, error.body.holder);
    }
    this.emit();
  }

  async takeOver(): Promise<void> {
    const prompt = this.lockPrompt;
    if (!prompt) return;
    await this.runAction("takeover", async () => {
      await post(`/api/scenes/${this.sceneId}/locks/${encodeURIComponent(prompt.nodeId)}/takeover`);
      this.locks.set(prompt.nodeId, this.me);
      this.lockPrompt = null;
      this.status = `You now hold ${this.nodeName(prompt.nodeId)}.`;
      this.emit();
      await prompt.send();
    });
  }

  cancelTakeover(): void {
    const prompt = this.lockPrompt;
    if (!prompt) return;
    this.lockPrompt = null;
    prompt.restore();
    this.emit();
    prompt.field?.focus();
  }

  // --- Undo, redo, restore -------------------------------------------------------------------------------------

  stateName(id: string): string {
    const state = this.graph.states.find((s) => s.id === id);
    if (state) return state.name;
    const added = this.log.all().findLast((op) => op.type === "state.add" && "state" in op.payload && op.payload.state.id === id);
    return added && "state" in added.payload ? added.payload.state.name : id;
  }

  /** The state a refused undo or redo is about: the caller's next batch dry-run on the latest graph until an operation fails. */
  private conflictState(kind: "undo" | "redo"): string | null {
    const mine = this.log.all().filter((op) => this.isMe(op.author));
    const batches = mine.filter((op, i) => i === 0 || mine[i - 1].batchId !== op.batchId);
    const target = undoStacks(batches)[kind].at(-1);
    const ops = mine.filter((op) => op.batchId === target);
    const steps = kind === "undo" ? ops.reverse().map((op) => op.inverse) : ops.flatMap((op) => this.log.operation(op.seq) ?? []);
    const graph = structuredClone(this.graph);
    for (const step of steps) {
      const applied = applyOperation(graph, step);
      if (!applied.ok) return applied.stateId;
    }
    return null;
  }

  private conflictCopy(error: ApiError, verb: "undo" | "redo" | "restore"): string {
    const holder = error.body.holder;
    const nodeId = typeof error.body.nodeId === "string" ? error.body.nodeId : null;
    const shown = verb === "restore" ? "restore" : "undo";
    if (error.code === "locked" && isAuthor(holder)) return `Cannot ${shown}: ${holder.name} is editing ${this.nodeName(nodeId ?? "")}.`;
    if (error.code === "undo_conflict" && nodeId !== null) return `Cannot ${shown}: a later change removed ${this.nodeName(nodeId)}.`;
    if (error.code === "undo_conflict" && verb !== "restore") {
      const stateId = this.conflictState(verb);
      if (stateId !== null) return `Cannot undo: a later change removed or uses state ${this.stateName(stateId)}.`;
    }
    if (error.code === "workspace_read_only") return READ_ONLY_COPY.dunning;
    return verb === "restore" ? "The scene could not be restored." : "Nothing changed.";
  }

  async undoRedo(kind: "undo" | "redo"): Promise<void> {
    if (!this.canEdit || this.busy.has(kind)) return;
    await this.runAction(kind, async () => {
      try {
        await post(`/api/scenes/${this.sceneId}/${kind}`);
        this.playhead = this.log.latestSeq;
        await this.refreshOps();
        this.status = kind === "undo" ? "Undone." : "Redone.";
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.code === "nothing_to_undo") this.status = "Nothing to undo.";
        else if (error.code === "nothing_to_redo") this.status = "Nothing to redo.";
        else this.status = this.conflictCopy(error, kind);
      }
    });
  }

  async restore(): Promise<void> {
    const toSeq = this.playhead;
    await this.runAction("restore", async () => {
      try {
        await post(`/api/scenes/${this.sceneId}/restore`, { toSeq });
        this.playhead = this.log.latestSeq;
        await this.refreshOps();
        this.playhead = this.log.latestSeq;
        this.drawShown([]);
        this.status = `Restored to operation ${toSeq}.`;
      } catch (error) {
        this.status = error instanceof ApiError ? this.conflictCopy(error, "restore") : "The scene could not be restored.";
      }
    });
  }

  // --- States and camera views ---------------------------------------------------------------------------------

  chooseState(stateId: string): void {
    const from = this.stateId;
    this.stateId = stateId;
    const link = this.shown.graph.transitions.find((t) => t.from === from && t.to === stateId);
    this.view?.animateToState(stateId, prefersReducedMotion() ? 0 : link?.durationMs ?? 250);
    this.emit();
  }

  async addState(name: string): Promise<string | null> {
    const id = `st_${randomHex(10)}`;
    try {
      await this.send([{ type: "state.add", payload: { state: { id, name } } }]);
      this.chooseState(id);
      return null;
    } catch (error) {
      return error instanceof ApiError ? Object.values(error.fieldErrors)[0] ?? this.explain(error, "") : "The state could not be added.";
    }
  }

  // --- Presence and events -------------------------------------------------------------------------------------

  async beat(): Promise<void> {
    await post(`/api/scenes/${this.sceneId}/presence`, { selection: this.selection, cursor: [0.5, 0.5] }).catch(() => undefined);
  }

  connect(): void {
    void this.beat();
    this.heartbeat = window.setInterval(() => { void this.beat(); }, HEARTBEAT_MS);
    const events = new EventSource(`/api/scenes/${this.sceneId}/events`);
    this.events = events;
    events.addEventListener("op", (e) => {
      const data: { ops: Op[] } = JSON.parse(e.data);
      this.receive(data.ops, this.atLatest);
    });
    events.addEventListener("lock", (e) => {
      const data: { nodeId: string; holder: Author | null } = JSON.parse(e.data);
      const before = this.locks.get(data.nodeId);
      if (data.holder) this.locks.set(data.nodeId, data.holder); else this.locks.delete(data.nodeId);
      if (before && this.isMe(before) && data.holder && !this.isMe(data.holder)) {
        this.status = `${data.holder.name} took over ${this.nodeName(data.nodeId)}.`;
      }
      this.emit();
    });
    events.addEventListener("presence", (e) => {
      const data: { authors: Presence[] } = JSON.parse(e.data);
      this.presence = data.authors;
      this.emit();
    });
    events.addEventListener("comment", (e) => {
      const comment: Comment = JSON.parse(e.data);
      this.comments = [...this.comments.filter((c) => c.id !== comment.id), comment];
      this.emit();
    });
    events.addEventListener("version", (e) => {
      const version: Version = JSON.parse(e.data);
      this.versions = [...this.versions.filter((v) => v.id !== version.id), version].sort((a, b) => a.number - b.number);
      this.emit();
    });
  }

  disconnect(): void {
    this.events?.close();
    window.clearInterval(this.heartbeat);
    window.clearTimeout(this.highlightTimer);
    cancelAnimationFrame(this.tweenFrame);
    if (this.selection && this.heldByMe(this.selection)) {
      void del(`/api/scenes/${this.sceneId}/locks/${encodeURIComponent(this.selection)}`).catch(() => undefined);
    }
  }

  // --- Comments, versions, links, assets -----------------------------------------------------------------------

  async loadComments(): Promise<void> {
    this.comments = (await get<{ comments: Comment[] }>(`/api/scenes/${this.sceneId}/comments`)).comments;
  }

  async loadVersions(): Promise<void> {
    this.versions = (await get<{ versions: Version[] }>(`/api/scenes/${this.sceneId}/versions`)).versions;
    const reviewable = this.versions.filter((v) => v.state === "draft" || v.state === "in_review" || v.state === "scheduled");
    const known = new Map(this.links.map((l) => [l.id, l.token]));
    const lists = await Promise.all(reviewable.map((v) => get<{ links: ReviewLink[] }>(`/api/versions/${v.id}/review-links`).then((r) => r.links.map((l) => ({ ...l, versionId: v.id, token: known.get(l.id) })))));
    this.links = lists.flat();
  }

  async loadAssets(): Promise<void> {
    this.assets = (await get<{ assets: Asset[] }>("/api/assets")).assets;
  }

  async uploadThumbnail(versionId: string): Promise<void> {
    const png = await this.view?.snapshot();
    if (png) await request(`PUT`, `/api/versions/${versionId}/thumbnail`, undefined, { raw: png, contentType: "image/png" }).catch(() => undefined);
  }

  setStatus(text: string): void { this.status = text; this.emit(); }

  localTime(iso: string): string { return localTime(iso, this.timeZone); }

  dispose(): void { this.disconnect(); this.view?.dispose(); }
}
