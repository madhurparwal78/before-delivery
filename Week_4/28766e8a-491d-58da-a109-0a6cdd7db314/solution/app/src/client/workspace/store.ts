// Workspace state: the server's document, local changes waiting to save (kept in localStorage),
// the live socket, presence and the side panels' data (brief: Working together, Offline, Sessions).
import { copy } from "../../shared/copy";
import { applyBroadcast, commit, OpError, type ApplyContext } from "../../shared/ops";
import { canEdit } from "../../shared/rules";
import type {
  Box, Change, CommentView, DiagramDocument, ExportView, InviteView, MemberView, Op, Page, PresencePerson, Role, ServerMessage, UserView,
  VersionView,
} from "../../shared/types";
import { announce } from "../announce";
import { api } from "../api";

const OFFLINE_AFTER_MS = 3000;
const RETRY_MS = 2000;
const SAVED_FOR_MS = 3000;
const GAP_RESYNC_MS = 1000;
const GLIDE_MS = 240;

interface QueuedOp {
  opId: string;
  baseSeq: number;
  op: Op;
  /** `do` ops join the undo stack; `undo` and `redo` move entries between the stacks. */
  history: "do" | "undo" | "redo" | "none";
  /** For undo/redo: the opId of the operation being reversed. */
  target?: string;
  /** Label for the moved notice, when the operation moves shapes and was made online. */
  moveLabel?: string | null;
  /** Label for the moved notice of a delete, announced only when connectors rerouted. */
  deleteLabel?: string | null;
  ackedSeq?: number;
}

interface UndoEntry {
  opId: string;
  seq: number | null;
}

interface RemoteCursor {
  userId: string;
  name: string;
  page: string;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  start: number;
}

interface Glide {
  dx: number;
  dy: number;
  start: number;
}

type Connection = "connecting" | "online" | "offline" | "ended";

export type Tab = "inspector" | "comments" | "history";

/** The control focus returns to when an editor, menu or dialog closes. */
export type Opener = HTMLElement | SVGElement | null;

/** The shape whose label editor is open. */
interface Editing {
  shapeId: string;
}

interface MenuRequest {
  kind: "shape-actions" | "align" | "insert";
  /** The anchor rectangle in viewport pixels: the press point, the selected shape or the opening button. */
  anchor: { x: number; y: number; w: number; h: number };
  opener: Opener;
}

type Ordered = Extract<ServerMessage, { type: "op" | "ack" }>;

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function randomRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

export function newRef(): string {
  return randomRef();
}

function tmpId(prefix: string, ref: string): string {
  return `${prefix}tmp${ref}`;
}

const TMP = /[a-z]_tmp[a-z0-9]{9}/;

export class WorkspaceStore {
  readonly diagramId: string;
  me: UserView | null = null;
  role: Role = "viewer";
  ownerName = "";
  title = "";
  confirmed: DiagramDocument | null = null;
  view: DiagramDocument | null = null;
  pending: QueuedOp[] = [];
  connection: Connection = "connecting";
  offlineBanner = false;
  savedBanner = false;
  notFound = false;
  presence: PresencePerson[] = [];
  cursors = new Map<string, RemoteCursor>();
  glides = new Map<string, Glide>();
  comments: CommentView[] = [];
  versions: VersionView[] = [];
  exports: ExportView[] = [];
  members: { members: MemberView[]; invites: InviteView[] } | null = null;
  pageId = "";
  preview: { version: VersionView; document: DiagramDocument } | null = null;
  signInOpen = false;
  signInReturn: Opener = null;
  undoStack: UndoEntry[] = [];
  redoStack: UndoEntry[] = [];

  // Interface state shared by the canvas, inspector, rails and keyboard.
  selection: string[] = [];
  focusId: string | null = null;
  snap = true;
  zoom = 1;
  origin: [number, number] = [0, 0];
  /** Asks a component to move focus to the element with this data-focus-key after the next render. */
  focusKey: string | null = null;
  /** Ids of connectors in their 200 ms drop settle. */
  settling = new Set<string>();
  /** Boxes shapes are drawn at during the person's own drag or resize. */
  dragPreview: Map<string, Box> | null = null;
  editing: Editing | null = null;
  menu: MenuRequest | null = null;
  tab: Tab = "inspector";
  sheet: Tab | "layers" | null = null;
  commentTarget: string | null = null;
  openThread: string | null = null;
  composerFocus = 0;

  private socket: WebSocket | null = null;
  private inFlight: string | null = null;
  private incoming = new Map<number, Ordered>();
  private changesBySeq = new Map<number, Change[]>();
  private ackedSeqs = new Map<string, number>();
  private aliases = new Map<string, string>();
  private offlineTimer: ReturnType<typeof setTimeout> | null = null;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private replaying = false;
  private ticking = false;
  private listeners = new Set<() => void>();

  constructor(diagramId: string) {
    this.diagramId = diagramId;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ derived

  get editable(): boolean {
    return canEdit(this.role) && !this.preview;
  }

  get doc(): DiagramDocument | null {
    return this.preview?.document ?? this.view;
  }

  get page(): Page | null {
    const doc = this.doc;
    return doc?.pages.find((p) => p.id === this.pageId) ?? doc?.pages[0] ?? null;
  }

  get waiting(): number {
    return this.pending.filter((p) => p.ackedSeq === undefined).length;
  }

  /** The real id for a temporary id once the server has acknowledged it. */
  resolve(id: string): string {
    return this.aliases.get(id) ?? id;
  }

  /** A render key that stays the same when a temporary id becomes the server's id, so focus survives. */
  keyFor(id: string): string {
    for (const [tmp, real] of this.aliases) if (real === id) return tmp;
    return id;
  }

  // ------------------------------------------------------------ loading

  async load(): Promise<void> {
    const [me, doc, members] = await Promise.all([
      api<{ user: UserView }>("GET", "/api/me"),
      api<DiagramDocument>("GET", `/api/diagrams/${this.diagramId}/document`),
      api<{ members: MemberView[]; invites: InviteView[] }>("GET", `/api/diagrams/${this.diagramId}/members`),
    ]);
    if (!me.ok || me.status === 401) {
      location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    if (!doc.ok || !members.ok) {
      this.notFound = true;
      this.emit();
      return;
    }
    this.me = me.data.user;
    this.members = members.data;
    this.role = members.data.members.find((m) => m.userId === this.me?.id)?.role ?? "viewer";
    this.ownerName = members.data.members.find((m) => m.role === "owner")?.name ?? "";
    this.confirmed = doc.data;
    this.title = doc.data.title;
    this.pending = this.readQueue();
    this.recompute();
    await this.readAddress(false);
    void this.refreshComments();
    void this.refreshVersions();
    void this.refreshExports(true);
    this.startOfflineClock();
    this.connect();
    this.emit();
  }

  private queueKey(): string {
    return `linewell:queue:${this.diagramId}:${this.me?.id ?? ""}`;
  }

  private readQueue(): QueuedOp[] {
    try {
      const raw = localStorage.getItem(this.queueKey());
      return raw ? (JSON.parse(raw) as QueuedOp[]).filter((q) => q.ackedSeq === undefined) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    localStorage.setItem(this.queueKey(), JSON.stringify(this.pending.filter((p) => p.ackedSeq === undefined)));
  }

  // ------------------------------------------------------------ address

  private address(pageId: string, versionId: string | null): string {
    return `/d/${this.diagramId}?page=${encodeURIComponent(pageId)}${versionId ? `&version=${encodeURIComponent(versionId)}` : ""}`;
  }

  /** Reads page and version from the address (load, Back, Forward). */
  async readAddress(fromHistory = true): Promise<void> {
    const params = new URLSearchParams(location.search);
    const versionId = params.get("version");
    if (versionId) {
      if (this.preview?.version.id !== versionId) {
        const res = await api<{ version: VersionView; document: DiagramDocument }>("GET", `/api/diagrams/${this.diagramId}/versions/${versionId}`);
        if (!res.ok) {
          this.notFound = true;
          this.emit();
          return;
        }
        this.preview = res.data;
      }
    } else {
      this.preview = null;
    }
    const doc = this.doc;
    const wanted = params.get("page") ?? "";
    const page = doc?.pages.find((p) => p.id === wanted) ?? doc?.pages[0];
    this.pageId = page?.id ?? "";
    if (page && page.id !== wanted) history.replaceState(null, "", this.address(page.id, this.preview?.version.id ?? null));
    if (fromHistory) this.emit();
  }

  setPage(pageId: string): void {
    if (pageId === this.pageId) return;
    this.pageId = pageId;
    history.pushState(null, "", this.address(pageId, this.preview?.version.id ?? null));
    this.emit();
  }

  async openVersion(version: VersionView): Promise<void> {
    const res = await api<{ version: VersionView; document: DiagramDocument }>("GET", `/api/diagrams/${this.diagramId}/versions/${version.id}`);
    if (!res.ok) return;
    this.preview = res.data;
    const page = res.data.document.pages.find((p) => p.id === this.pageId) ?? res.data.document.pages[0];
    this.pageId = page?.id ?? "";
    history.pushState(null, "", this.address(this.pageId, version.id));
    this.emit();
  }

  backToLatest(replace = false): void {
    this.preview = null;
    const page = this.view?.pages.find((p) => p.id === this.pageId) ?? this.view?.pages[0];
    this.pageId = page?.id ?? "";
    const target = this.address(this.pageId, null);
    if (replace) history.replaceState(null, "", target);
    else history.pushState(null, "", target);
    this.emit();
  }

  // ------------------------------------------------------------ connection

  private startOfflineClock(): void {
    if (this.offlineTimer) clearTimeout(this.offlineTimer);
    this.offlineTimer = setTimeout(() => {
      if (this.connection === "offline" || this.connection === "connecting") {
        this.offlineBanner = true;
        this.emit();
      }
    }, OFFLINE_AFTER_MS);
  }

  connect(): void {
    if (this.connection === "ended" || this.notFound) return;
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws?diagram=${encodeURIComponent(this.diagramId)}`);
    this.socket = ws;
    ws.addEventListener("message", (event) => this.onMessage(JSON.parse(String(event.data)) as ServerMessage));
    ws.addEventListener("close", (event) => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.inFlight = null;
      if (event.code === 4401) return this.sessionEnded();
      if (event.code === 4404) {
        this.notFound = true;
        this.emit();
        return;
      }
      const wasOnline = this.connection === "online";
      this.connection = "offline";
      if (wasOnline) this.startOfflineClock();
      this.presence = [];
      this.cursors.clear();
      this.retryTimer = setTimeout(() => this.connect(), RETRY_MS);
      this.emit();
    });
  }

  private sessionEnded(): void {
    if (this.connection === "ended") return;
    this.connection = "ended";
    this.socket?.close();
    this.socket = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.signInReturn = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
    this.signInOpen = true;
    this.presence = [];
    this.cursors.clear();
    this.emit();
  }

  /** Any API call answering 401 ends the session in place. */
  async call<T>(method: string, path: string, body?: unknown) {
    const res = await api<T>(method, path, body);
    if (!res.ok && res.status === 401) this.sessionEnded();
    return res;
  }

  async signIn(password: string): Promise<boolean> {
    const res = await api<{ user: UserView }>("POST", "/api/auth/signin", { email: this.me?.email ?? "", password });
    if (!res.ok) return false;
    this.signInOpen = false;
    this.connection = "connecting";
    this.replaying = true;
    this.connect();
    this.emit();
    return true;
  }

  closeSignIn(): void {
    this.signInOpen = false;
    this.emit();
  }

  openSignIn(opener: Opener): void {
    this.signInReturn = opener;
    this.signInOpen = true;
    this.emit();
  }

  // ------------------------------------------------------------ messages

  private onMessage(message: ServerMessage): void {
    switch (message.type) {
      case "hello": {
        const shown = this.offlineBanner || this.pending.length > 0;
        this.connection = "online";
        this.offlineBanner = false;
        this.confirmed = message.document;
        this.title = message.document.title;
        this.role = message.role;
        this.ownerName = message.ownerName;
        this.presence = message.presence;
        this.incoming.clear();
        this.settleAcked();
        this.recompute();
        if (shown) this.replaying = true;
        this.flush();
        void this.refreshExports(true);
        this.emit();
        return;
      }
      case "ack":
      case "op":
        if (message.type === "ack") this.onAck(message);
        this.incoming.set(message.seq, message);
        this.drain();
        return;
      case "refused":
        this.onRefused(message);
        return;
      case "presence":
        this.presence = message.people;
        for (const id of this.cursors.keys()) if (!message.people.some((p) => p.userId === id)) this.cursors.delete(id);
        this.emit();
        return;
      case "joined":
        announce(copy.joined(message.name));
        return;
      case "cursor": {
        const old = this.cursors.get(message.userId);
        const now = performance.now();
        const at = old ? this.cursorAt(old, now) : { x: message.x, y: message.y };
        const instant = !old || old.page !== message.page || reducedMotion();
        this.cursors.set(message.userId, { ...message, fromX: instant ? message.x : at.x, fromY: instant ? message.y : at.y, start: now });
        this.tick();
        this.emit();
        return;
      }
      case "cursor_gone":
        this.cursors.delete(message.userId);
        this.emit();
        return;
      case "role":
        this.role = message.role;
        void this.refreshMembers();
        this.emit();
        return;
      case "comments":
        void this.refreshComments();
        return;
      case "versions":
        void this.refreshVersions();
        return;
      case "members":
        void this.refreshMembers();
        return;
      case "export":
        this.onExport(message.export);
        return;
    }
  }

  cursorAt(c: RemoteCursor, now: number): { x: number; y: number } {
    const t = Math.min(1, (now - c.start) / GLIDE_MS);
    const e = 1 - (1 - t) ** 3;
    return { x: c.fromX + (c.x - c.fromX) * e, y: c.fromY + (c.y - c.fromY) * e };
  }

  private onAck(message: Extract<ServerMessage, { type: "ack" }>): void {
    const item = this.pending.find((p) => p.opId === message.opId);
    if (this.inFlight === message.opId) this.inFlight = null;
    if (!item) return;
    item.ackedSeq = message.seq;
    this.ackedSeqs.set(item.opId, message.seq);
    for (const [ref, id] of Object.entries(message.ids)) {
      for (const prefix of ["s_", "c_", "p_", "l_", "g_"]) this.aliases.set(tmpId(prefix, ref.replace(/\.layer$/, "")), id);
    }
    this.rewriteTmp(message.ids);
    const entry = [...this.undoStack, ...this.redoStack].find((e) => e.opId === item.opId);
    if (entry) entry.seq = message.seq;
    if (item.history === "undo") this.redoStack.push({ opId: item.opId, seq: message.seq });
    if (item.history === "redo") this.undoStack.push({ opId: item.opId, seq: message.seq });
    if (item.moveLabel) announce(copy.moved(item.moveLabel, message.rerouted.length));
    if (item.deleteLabel && message.rerouted.length) announce(copy.moved(item.deleteLabel, message.rerouted.length));
    this.persist();
    this.flush();
  }

  /** Replaces temporary ids in waiting operations and in the page address once the server names them. */
  private rewriteTmp(ids: Record<string, string>): void {
    const pairs: [string, string][] = [];
    for (const [ref, id] of Object.entries(ids)) pairs.push([tmpId(id.slice(0, 2), ref.replace(/\.layer$/, "")), id]);
    if (!pairs.length) return;
    const swap = (text: string) => pairs.reduce((t, [from, to]) => t.split(from).join(to), text);
    for (const p of this.pending) p.op = JSON.parse(swap(JSON.stringify(p.op))) as Op;
    const page = pairs.find(([from]) => from === this.pageId);
    if (page) {
      this.pageId = page[1];
      history.replaceState(null, "", this.address(page[1], null));
    }
  }

  private onRefused(message: Extract<ServerMessage, { type: "refused" }>): void {
    if (this.inFlight === message.opId) this.inFlight = null;
    if (message.status === 503 || message.status === 401) return;
    const item = this.pending.find((p) => p.opId === message.opId);
    this.pending = this.pending.filter((p) => p.opId !== message.opId);
    this.undoStack = this.undoStack.filter((e) => e.opId !== message.opId);
    this.redoStack = this.redoStack.filter((e) => e.opId !== message.opId);
    if (message.status === 403) announce(copy.role);
    else if (message.status === 409 && message.error.code !== "op_conflict") announce(message.error.message);
    if (item) this.persist();
    this.recompute();
    this.afterQueue();
    this.flush();
    this.emit();
  }

  private drain(): void {
    if (!this.confirmed) return;
    let applied = false;
    for (;;) {
      for (const seq of [...this.incoming.keys()]) if (seq <= this.confirmed.seq) this.incoming.delete(seq);
      const next = this.incoming.get(this.confirmed.seq + 1);
      if (!next) break;
      this.incoming.delete(next.seq);
      this.applyOrdered(next);
      applied = true;
    }
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.gapTimer = this.incoming.size ? setTimeout(() => void this.resync(), GAP_RESYNC_MS) : null;
    this.settleAcked();
    if (applied) this.recompute();
    this.afterQueue();
    this.emit();
  }

  private applyOrdered(message: Ordered): void {
    const before = this.confirmed as DiagramDocument;
    this.changesBySeq.set(message.seq, message.changes);
    this.confirmed = applyBroadcast(before, message.changes, message.routes, message.seq);
    if (message.type === "ack") return;
    if (message.author.id !== this.me?.id && !reducedMotion()) this.startGlides(message.changes);
    if (this.me && message.replaced.includes(this.me.id)) announce(copy.replaced(message.author.name, message.label));
    if (message.restored) {
      announce(copy.restored(message.author.name, message.restored));
      void this.refreshComments();
    }
  }

  private startGlides(changes: Change[]): void {
    const now = performance.now();
    for (const c of changes) {
      if (!c.key.startsWith("shape:") || !c.before || !c.after) continue;
      const dx = (c.before.x as number) - (c.after.x as number);
      const dy = (c.before.y as number) - (c.after.y as number);
      if (dx || dy) this.glides.set(c.key.slice(6), { dx, dy, start: now });
    }
    if (this.glides.size) this.tick();
  }

  /** Drops waiting operations whose acknowledged seq is now part of the confirmed document. */
  private settleAcked(): void {
    const seq = this.confirmed?.seq ?? 0;
    this.pending = this.pending.filter((p) => p.ackedSeq === undefined || p.ackedSeq > seq);
  }

  private async resync(): Promise<void> {
    const res = await this.call<DiagramDocument>("GET", `/api/diagrams/${this.diagramId}/document`);
    if (!res.ok) return;
    this.confirmed = res.data;
    this.incoming.clear();
    this.settleAcked();
    this.recompute();
    this.emit();
  }

  private afterQueue(): void {
    if (!this.replaying || this.waiting > 0 || this.connection !== "online") return;
    this.replaying = false;
    this.savedBanner = true;
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => {
      this.savedBanner = false;
      this.emit();
    }, SAVED_FOR_MS);
  }

  // ------------------------------------------------------------ local changes

  private context(): ApplyContext {
    return {
      newId: tmpId,
      changesOf: (seq) => this.changesBySeq.get(seq) ?? [],
      versionDocument: () => {
        throw new OpError("invalid", "restore");
      },
    };
  }

  /** The displayed document: the confirmed one with every waiting change applied on top. */
  recompute(): void {
    let doc = this.confirmed;
    if (!doc) return;
    const seq = doc.seq;
    for (const item of this.pending) {
      if (item.ackedSeq !== undefined && item.ackedSeq <= seq) continue;
      const op: Op = item.op.kind === "undo" && item.op.seq < 0 && item.target
        ? { kind: "undo", seq: this.ackedSeqs.get(item.target) ?? -1 } : item.op;
      try {
        doc = commit(doc, op, this.context()).document;
      } catch (error) {
        if (!(error instanceof OpError)) throw error;
      }
    }
    this.view = doc;
  }

  /** Queues one operation, shows it at once and sends it when the socket is open. */
  submit(op: Op, options: { history?: QueuedOp["history"]; target?: string; moveLabel?: string | null; deleteLabel?: string | null } = {}): string {
    const opId = `op-${randomRef()}${randomRef()}`;
    const history = options.history ?? "do";
    const item: QueuedOp = {
      opId, baseSeq: this.confirmed?.seq ?? 0, op, history,
      ...(options.target ? { target: options.target } : {}),
      moveLabel: this.connection === "online" ? (options.moveLabel ?? null) : null,
      deleteLabel: this.connection === "online" ? (options.deleteLabel ?? null) : null,
    };
    this.pending.push(item);
    if (history === "do") {
      this.undoStack.push({ opId, seq: null });
      this.redoStack = [];
    }
    this.persist();
    this.recompute();
    this.flush();
    this.emit();
    return opId;
  }

  private flush(): void {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.connection !== "online" || this.inFlight) return;
    const item = this.pending.find((p) => p.ackedSeq === undefined);
    if (!item) return;
    let op = item.op;
    if (op.kind === "undo" && op.seq < 0 && item.target) op = { kind: "undo", seq: this.ackedSeqs.get(item.target) ?? -1 };
    if (TMP.test(JSON.stringify(op)) || (op.kind === "undo" && op.seq < 0)) {
      this.pending = this.pending.filter((p) => p !== item);
      this.persist();
      this.recompute();
      this.flush();
      return;
    }
    item.op = op;
    this.inFlight = item.opId;
    ws.send(JSON.stringify({ type: "op", opId: item.opId, baseSeq: item.baseSeq, op }));
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.submit({ kind: "undo", seq: entry.seq ?? -1 }, { history: "undo", target: entry.opId });
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.submit({ kind: "undo", seq: entry.seq ?? -1 }, { history: "redo", target: entry.opId });
  }

  /** The restorer's Ctrl+Z undoes a restore like any of their own operations. */
  rememberRestore(seq: number): void {
    const opId = `restore-${seq}`;
    this.ackedSeqs.set(opId, seq);
    this.undoStack.push({ opId, seq });
    this.redoStack = [];
  }

  sendCursor(page: string, x: number, y: number): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.connection === "online") this.socket.send(JSON.stringify({ type: "cursor", page, x, y }));
  }

  // ------------------------------------------------------------ animation ticker

  /** Re-renders every animation frame while glides or cursor glides run. */
  tick(): void {
    if (this.ticking) return;
    this.ticking = true;
    const frame = () => {
      const now = performance.now();
      for (const [id, g] of this.glides) if (now - g.start >= GLIDE_MS) this.glides.delete(id);
      const moving = this.glides.size > 0 || [...this.cursors.values()].some((c) => now - c.start < GLIDE_MS);
      this.emit();
      if (moving) requestAnimationFrame(frame);
      else this.ticking = false;
    };
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ panels

  async refreshComments(): Promise<void> {
    const res = await this.call<{ comments: CommentView[] }>("GET", `/api/diagrams/${this.diagramId}/comments`);
    if (res.ok) {
      this.comments = res.data.comments;
      this.emit();
    }
  }

  async refreshVersions(): Promise<void> {
    const res = await this.call<{ versions: VersionView[] }>("GET", `/api/diagrams/${this.diagramId}/versions`);
    if (res.ok) {
      this.versions = res.data.versions;
      this.emit();
    }
  }

  async refreshMembers(): Promise<void> {
    const res = await this.call<{ members: MemberView[]; invites: InviteView[] }>("GET", `/api/diagrams/${this.diagramId}/members`);
    if (res.ok) {
      this.members = res.data;
      this.ownerName = res.data.members.find((m) => m.role === "owner")?.name ?? this.ownerName;
      this.emit();
    }
  }

  private exportMemory(): { requested: string[]; announced: string[] } {
    try {
      return JSON.parse(sessionStorage.getItem(`linewell:exports:${this.diagramId}`) ?? "") as { requested: string[]; announced: string[] };
    } catch {
      return { requested: [], announced: [] };
    }
  }

  private saveExportMemory(memory: { requested: string[]; announced: string[] }): void {
    sessionStorage.setItem(`linewell:exports:${this.diagramId}`, JSON.stringify(memory));
  }

  async refreshExports(announceReady = false): Promise<void> {
    const res = await this.call<{ exports: ExportView[] }>("GET", `/api/diagrams/${this.diagramId}/exports`);
    if (!res.ok) return;
    // `ready` is final: a list answered before a socket `ready` message must not take it back.
    const ready = new Map(this.exports.filter((x) => x.status === "ready").map((x) => [x.id, x]));
    this.exports = res.data.exports.map((x) => ready.get(x.id) ?? x);
    if (announceReady) for (const x of this.exports) this.announceIfReady(x);
    this.emit();
  }

  rememberExport(id: string): void {
    const memory = this.exportMemory();
    memory.requested.push(id);
    this.saveExportMemory(memory);
    const known = this.exports.find((x) => x.id === id);
    if (known) this.announceIfReady(known);
  }

  /** `Export ready.` is announced once per export, in the tab that requested it (reloads included). */
  private announceIfReady(x: ExportView): void {
    if (x.status !== "ready") return;
    const memory = this.exportMemory();
    if (!memory.requested.includes(x.id) || memory.announced.includes(x.id)) return;
    memory.announced.push(x.id);
    this.saveExportMemory(memory);
    announce(copy.exportReady);
  }

  private onExport(x: ExportView): void {
    this.exports = [x, ...this.exports.filter((e) => e.id !== x.id)].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
    this.announceIfReady(x);
    this.emit();
  }

  dispose(): void {
    this.connection = "ended";
    this.socket?.close();
    for (const t of [this.offlineTimer, this.savedTimer, this.gapTimer, this.retryTimer]) if (t) clearTimeout(t);
  }
}
