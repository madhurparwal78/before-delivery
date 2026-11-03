import { flushSync } from "react-dom";
import { applyChanges, execute, needsServerIds, parseOperation } from "../../shared/apply.js";
import type { CommentThread, Created, EditOp, Person, Role, ServerMessage, WorkspaceDoc } from "../../shared/types.js";
import { api } from "../api.js";

export interface Me extends Person {
  role: Role;
}

interface Cursor {
  name: string;
  pageId: string;
  x: number;
  y: number;
}

interface Pending {
  opId: string;
  body: Record<string, unknown>;
  optimistic: boolean;
  onApplied?: (created: Created | undefined) => void;
  onRejected?: (error: { code: string; message: string }) => void;
}

interface SyncEvents {
  joined: (person: Person) => void;
  conflict: (message: Extract<ServerMessage, { type: "conflict" }>) => void;
  role: (role: Role) => void;
  removed: () => void;
  comment: (thread: CommentThread) => void;
  restored: (by: Person, versionName: string) => void;
  /** An accepted operation was applied (a selection whose node is gone moves to its parent). */
  changed: () => void;
}

function opId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The live document: the server's last accepted state plus this person's pending operations.
 * Every message is applied inside the socket's message handler and rendered synchronously.
 */
export class Sync {
  server: WorkspaceDoc;
  view: WorkspaceDoc;
  me: Me;
  people: Me[] = [];
  cursors = new Map<string, Cursor>();
  selections = new Map<string, string>();
  connected = false;
  private pending: Pending[] = [];
  private ws: WebSocket | null = null;
  private outbox: string[] = [];
  private buffered: Extract<ServerMessage, { type: "op" }>[] = [];
  private catchingUp = false;
  private listeners = new Set<() => void>();
  private closed = false;
  events: SyncEvents = {
    joined: () => undefined,
    conflict: () => undefined,
    role: () => undefined,
    removed: () => undefined,
    comment: () => undefined,
    restored: () => undefined,
    changed: () => undefined,
  };

  constructor(doc: WorkspaceDoc, me: Me) {
    this.server = doc;
    this.view = doc;
    this.me = me;
  }

  listen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  connect(): void {
    if (this.closed) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?workspace=${encodeURIComponent(this.server.id)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      for (const message of this.outbox.splice(0)) ws.send(message);
    };
    ws.onmessage = (event) => {
      flushSync(() => this.receive(JSON.parse(String(event.data)) as ServerMessage));
    };
    ws.onclose = (event) => {
      this.connected = false;
      if (event.code === 4404 || event.code === 4401) {
        this.closed = true;
        this.events.removed();
        return;
      }
      if (!this.closed) window.setTimeout(() => this.connect(), 1000);
    };
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private sendRaw(message: unknown): void {
    const text = JSON.stringify(message);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else this.outbox.push(text);
  }

  sendCursor(pageId: string, x: number | null, y: number | null): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "cursor", pageId, x, y }));
  }

  sendSelection(nodeId: string | null): void {
    this.sendRaw({ type: "select", nodeId });
  }

  /**
   * Send an operation. Edits that need no new ids show at once (optimistically, in this handler);
   * the rest show when the server's copy arrives with its ids.
   */
  send(op: EditOp | { kind: "undo" } | { kind: "redo" }, callbacks: Pick<Pending, "onApplied" | "onRejected"> = {}): void {
    const body: Record<string, unknown> = { ...op, opId: opId(), baseSeq: this.server.seq };
    const optimistic = !needsServerIds(op);
    const entry: Pending = { opId: body.opId as string, body, optimistic, ...callbacks };
    if (optimistic) {
      const next = this.view === this.server ? structuredClone(this.server) : this.view;
      try {
        execute(next, parseOperation(body), { newId: () => "" });
        this.view = next;
      } catch {
        entry.optimistic = false;
      }
    }
    this.pending.push(entry);
    this.sendRaw({ type: "op", op: body });
    this.emit();
  }

  private rebuild(): void {
    const local = this.pending.filter((p) => p.optimistic);
    if (!local.length) {
      this.view = this.server;
      return;
    }
    const next = structuredClone(this.server);
    for (const p of local) {
      try {
        execute(next, parseOperation({ ...p.body }), { newId: () => "" });
      } catch {
        p.optimistic = false;
      }
    }
    this.view = next;
  }

  private applyOp(message: Extract<ServerMessage, { type: "op" }>): void {
    applyChanges(this.server, message.changes);
    this.server.seq = message.seq;
    const mine = message.author.id === this.me.id ? this.pending.findIndex((p) => p.opId === message.op.opId) : -1;
    const done = mine >= 0 ? this.pending.splice(mine, 1)[0] : undefined;
    this.rebuild();
    done?.onApplied?.(message.created);
  }

  private async catchUp(): Promise<void> {
    if (this.catchingUp) return;
    this.catchingUp = true;
    const result = await api<WorkspaceDoc>("GET", `/api/workspaces/${this.server.id}/document`);
    this.catchingUp = false;
    if (!result.ok) return;
    flushSync(() => {
      this.server = result.data;
      const later = this.buffered.filter((m) => m.seq > this.server.seq).sort((a, b) => a.seq - b.seq);
      this.buffered = [];
      for (const message of later) if (message.seq === this.server.seq + 1) this.applyOp(message);
      this.rebuild();
      this.events.changed();
      this.emit();
    });
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case "hello":
        this.me = { ...message.you };
        if (message.seq !== this.server.seq) void this.catchUp();
        break;
      case "op":
        if (message.seq <= this.server.seq) break;
        if (this.catchingUp || message.seq !== this.server.seq + 1) {
          this.buffered.push(message);
          void this.catchUp();
          break;
        }
        this.applyOp(message);
        this.events.changed();
        break;
      case "ack":
        break;
      case "reject": {
        const at = this.pending.findIndex((p) => p.opId === message.opId);
        const entry = at >= 0 ? this.pending.splice(at, 1)[0] : undefined;
        this.rebuild();
        entry?.onRejected?.(message.error);
        if (message.error.code === "node_deleted") void this.catchUp();
        break;
      }
      case "conflict":
        this.events.conflict(message);
        break;
      case "presence": {
        const before = new Set(this.people.map((p) => p.id));
        const wasGreeted = this.people.length > 0;
        this.people = message.people;
        for (const id of [...this.cursors.keys()]) if (!message.people.some((p) => p.id === id)) this.cursors.delete(id);
        for (const id of [...this.selections.keys()]) if (!message.people.some((p) => p.id === id)) this.selections.delete(id);
        const mine = message.people.find((p) => p.id === this.me.id);
        if (mine) this.me = { ...this.me, role: mine.role };
        if (wasGreeted) for (const p of message.people) if (!before.has(p.id) && p.id !== this.me.id) this.events.joined(p);
        break;
      }
      case "cursor":
        if (message.x === null || message.y === null) this.cursors.delete(message.userId);
        else this.cursors.set(message.userId, { name: message.name, pageId: message.pageId, x: message.x, y: message.y });
        break;
      case "selection":
        if (message.nodeId) this.selections.set(message.userId, message.nodeId);
        else this.selections.delete(message.userId);
        break;
      case "role":
        this.me = { ...this.me, role: message.role };
        this.events.role(message.role);
        break;
      case "comment":
        this.events.comment(message.thread);
        break;
      case "restored":
        this.events.restored(message.by, message.versionName);
        break;
    }
    this.emit();
  }
}
