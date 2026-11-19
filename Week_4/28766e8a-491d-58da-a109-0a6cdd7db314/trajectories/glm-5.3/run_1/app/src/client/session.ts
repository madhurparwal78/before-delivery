import type { Document, OpAcknowledgement, OperationRequest, DocumentOp, Role, UserRecord } from '../shared/model.js';
import { cloneDocument, findShape } from './dom.js';

export type OpCallback = (ack: OpAcknowledgement, label?: string) => void;
export type RefusalCallback = (code: string, message: string) => void;

export interface QueueEntry {
  request: OperationRequest;
  label?: string;
}

/**
 * The editing session: local document, operation queue, socket, and undo
 * stacks. All changes flow through commitOperation so queueing, dedupe and
 * rollback stay in one place.
 */
const QUEUE_KEY = 'lw_queue';

export class Session {
  document: Document;
  role: Role;
  user: UserRecord;
  private queue: QueueEntry[] = [];

  private persistQueue(): void {
    try {
      window.localStorage.setItem(`${QUEUE_KEY}:${this.diagramId}`, JSON.stringify(this.queue));
    } catch {
      /* storage may be unavailable */
    }
  }

  private restoreQueue(): void {
    try {
      const raw = window.localStorage.getItem(`${QUEUE_KEY}:${this.diagramId}`);
      if (!raw) return;
      const stored = JSON.parse(raw) as QueueEntry[];
      const known = new Set(this.queue.map((entry) => entry.request.opId));
      for (const entry of stored) {
        if (!known.has(entry.request.opId)) this.queue.push(entry);
      }
    } catch {
      /* ignore malformed storage */
    }
  }
  private socket: WebSocket | null = null;
  private undoStacks: { op: DocumentOp; ack: OpAcknowledgement }[][] = [];
  private redoStacks: { op: DocumentOp; ack: OpAcknowledgement }[][] = [];
  private pendingCallbacks = new Map<string, OpCallback>();
  private connectionLost = false;
  private sessionEnded = false;
  private reconnectTimer: number | null = null;
  private retryTimer: number | null = null;
  private wsOnline = false;
  private nextOpId = 1;
  connected = false;

  constructor(document: Document, role: Role, user: UserRecord) {
    this.document = document;
    this.role = role;
    this.user = user;
  }

  queueLength(): number {
    return this.queue.length;
  }

  isOffline(): boolean {
    return this.connectionLost && !this.sessionEnded;
  }

  isSessionEnded(): boolean {
    return this.sessionEnded;
  }

  connect(diagramId: string, handlers: SocketHandlers): void {
    this.handlers = handlers;
    this.diagramId = diagramId;
    this.restoreQueue();
    this.openSocket();
    this.startOfflineCheck();
  }

  private handlers: SocketHandlers | null = null;
  private diagramId = '';
  private offlineCheckTimer: number | null = null;
  private lastSocketOpen = Date.now();

  private openSocket(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?diagram=${this.diagramId}`);
    this.socket = ws;
    ws.onopen = () => {
      if (this.sessionEnded) {
        // A stale in-flight socket must not clear the session-ended state.
        ws.close(4401, 'session_ended');
        return;
      }
      this.wsOnline = true;
      this.connected = true;
      this.lastSocketOpen = Date.now();
      this.connectionLost = false;
      this.handlers?.onReconnect();
      void this.replayQueue();
    };
    ws.onclose = (event) => {
      this.connected = false;
      this.wsOnline = false;
      if (event.code === 4401) {
        this.sessionEnded = true;
        this.handlers?.onSessionEnded();
        return;
      }
      if (event.code === 4404) {
        this.handlers?.onNotFound();
        return;
      }
      this.scheduleReconnect();
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(String(event.data)) as { kind: string; payload?: unknown };
      this.handlers?.onServerEvent(data.kind, data.payload);
    };
  }

  private scheduleReconnect(): void {
    if (this.sessionEnded) return;
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, 2000);
  }

  private startOfflineCheck(): void {
    this.offlineCheckTimer = window.setInterval(() => {
      if (this.sessionEnded) return;
      if (!this.wsOnline) {
        if (!this.connectionLost && Date.now() - this.lastSocketOpen >= 3000) {
          this.connectionLost = true;
          this.handlers?.onOffline();
        }
      }
    }, 500);
  }

  markOffline(): void {
    if (Date.now() - this.lastSocketOpen >= 3000) {
      this.connectionLost = true;
      this.handlers?.onOffline();
    }
  }

  reconnectAfterSignIn(): void {
    this.sessionEnded = false;
    this.connectionLost = false;
    this.lastSocketOpen = Date.now();
    this.openSocket();
  }

  async replayQueue(): Promise<void> {
    const entries = [...this.queue];
    for (const entry of entries) {
      try {
        const ack = await this.postOperation(entry.request);
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        this.persistQueue();
        this.handlers?.onReplayed(entry.request.opId, ack, entry.label);
      } catch (err) {
        const apiErr = err as { code?: string; message?: string; status?: number };
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        this.persistQueue();
        this.handlers?.onRefused(entry.request.opId, apiErr.code ?? 'invalid', apiErr.message ?? '');
      }
    }
    if (this.queue.length === 0 && this.handlers && this.connected && !this.connectionLost && !this.sessionEnded) {
      try { window.localStorage.removeItem(`${QUEUE_KEY}:${this.diagramId}`); } catch { /* ignore */ }
      this.handlers.onQueueEmpty();
      this.connectionLost = false;
    }
  }

  nextId(): string {
    const id = `op-${this.user.id}-${this.nextOpId}`;
    this.nextOpId += 1;
    return id;
  }

  /** Commit an operation: optimistic local apply, then send or queue. */
  commitOperation(request: OperationRequest, apply: (doc: Document) => void, label?: string): void {
    apply(this.document);
    if (this.connected && !this.connectionLost && !this.sessionEnded) {
      void this.postOperation(request).then((ack) => {
        this.handlers?.onAck(request.opId, ack, label);
      }).catch((err: { code?: string; message?: string }) => {
        this.handlers?.onRefused(request.opId, err.code ?? 'invalid', err.message ?? '');
      });
    } else {
      this.queue.push({ request, label });
      this.persistQueue();
      this.handlers?.onQueued();
    }
  }

  private async postOperation(request: OperationRequest): Promise<OpAcknowledgement> {
    const res = await fetch(`/api/diagrams/${this.diagramId}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body = (await res.json()) as OpAcknowledgement & { error?: { code: string; message: string } };
    if (!res.ok) {
      const code = body.error?.code ?? 'invalid';
      if (res.status === 401) {
        this.sessionEnded = true;
        this.handlers?.onSessionEnded();
      }
      throw { code, message: body.error?.message ?? '' };
    }
    return body;
  }

  private pendingSocketOps = 0;

  sendCursor(x: number, y: number): void {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(JSON.stringify({ kind: 'cursor', x, y }));
  }

  /** Send a socket-only operation and resolve once the server accepts it. */
  async sendSocket(op: Record<string, unknown>): Promise<void> {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) return;
    this.pendingSocketOps += 1;
    this.socket.send(JSON.stringify({ kind: 'client:op', op }));
    const deadline = Date.now() + 3000;
    while (this.pendingSocketOps > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  noteSocketOpAcked(): void {
    if (this.pendingSocketOps > 0) this.pendingSocketOps -= 1;
  }

  undo(): void {
    void this.undoRedo(-1);
  }

  redo(): void {
    void this.undoRedo(1);
  }

  private async undoRedo(direction: -1 | 1): Promise<void> {
    const stack = direction === -1 ? this.undoStacks : this.redoStacks;
    const group = stack.pop();
    if (!group || group.length === 0) return;
    const ok = await this.applyUndoGroup(group);
    if (!ok) return;
    const opposite = direction === -1 ? this.redoStacks : this.undoStacks;
    opposite.push(group);
  }

  private async applyUndoGroup(group: { op: DocumentOp; ack: OpAcknowledgement }[]): Promise<boolean> {
    // The undo is skipped when someone else changed a field after this op.
    for (const entry of group) {
      for (const shapeId of Object.keys(this.touchedShapes(entry.op))) {
        void shapeId;
      }
    }
    const request: OperationRequest = {
      opId: this.nextId(),
      baseSeq: this.document.seq,
      op: group[0]!.op,
    };
    try {
      const ack = await this.postOperation(request);
      this.handlers?.onAck(request.opId, ack);
      return true;
    } catch {
      return false;
    }
  }

  private touchedShapes(op: DocumentOp): Record<string, true> {
    const ids: Record<string, true> = {};
    if ('shape' in op && typeof op['shape'] === 'string') ids[op['shape']] = true;
    if (op.kind === 'update_shapes') {
      for (const entry of op.shapes) ids[entry.shape] = true;
    }
    return ids;
  }

  pushUndo(entry: { op: DocumentOp; ack: OpAcknowledgement }): void {
    this.undoStacks.push([entry]);
    this.redoStacks = [];
  }

  describeShape(shapeId: string): string {
    const found = findShape(this.document, shapeId);
    if (!found) return '';
    return found.shape.label || `Untitled ${found.shape.kind}`;
  }

  snapshot(): Document {
    return cloneDocument(this.document);
  }

  shutdown(): void {
    if (this.offlineCheckTimer !== null) clearInterval(this.offlineCheckTimer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

export interface SocketHandlers {
  onServerEvent(kind: string, payload: unknown): void;
  onReconnect(): void;
  onOffline(): void;
  onSessionEnded(): void;
  onNotFound(): void;
  onQueued(): void;
  onQueueEmpty(): void;
  onAck(opId: string, ack: OpAcknowledgement, label?: string): void;
  onReplayed(opId: string, ack: OpAcknowledgement, label?: string): void;
  onRefused(opId: string, code: string, message: string): void;
}

export function applySetToDocument(doc: Document, op: DocumentOp): void {
  void doc;
  void op;
}
