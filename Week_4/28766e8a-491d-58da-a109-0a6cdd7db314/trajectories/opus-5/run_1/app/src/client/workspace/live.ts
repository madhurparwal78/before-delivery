import { copy } from '../../shared/copy.js';
import {
  type DiagramDocument,
  type Page,
  type Role,
  findPage,
  findShape,
  shapeLabel,
} from '../../shared/document.js';
import { applyOperation } from '../../shared/engine.js';
import type { Operation } from '../../shared/operation.js';
import { announce } from '../announcer.js';
import {
  type PendingOperation,
  type PresencePerson,
  type WorkspaceState,
  currentPage,
  newOpId,
  recomputeRoutes,
  saveQueue,
  shownDocument,
} from './store.js';

/** 3 seconds of page time without the socket before the offline banner shows. */
const OFFLINE_AFTER_MS = 3000;
const RETRY_EVERY_MS = 2000;
const SAVED_BANNER_MS = 3000;
const CURSOR_EVERY_MS = 50;

interface HelloMessage {
  t: 'hello';
  you: { id: string; email: string; name: string };
  role: Role;
  ownerName: string;
  document: DiagramDocument;
  presence: PresencePerson[];
  exports: unknown[];
}

export interface LiveHandlers {
  /** The document, routes or banners changed and the screen must be rebuilt. */
  onChange(): void;
  /** Another person's accepted change arrived, so shapes glide to their new place. */
  onRemoteChange(pages: readonly string[]): void;
  onHello(message: HelloMessage): void;
  onRoleChange(role: Role): void;
  onCommentsChanged(): void;
  onVersionsChanged(): void;
  onMembersChanged(): void;
  onExportsChanged(): void;
  onNotFound(): void;
  onSessionEnded(): void;
  onRestored(actorName: string, versionName: string): void;
}

/**
 * The live socket, the local queue and the replay rule. Edits keep working while the
 * socket is away: they are applied on the canvas and queued in local storage, and each
 * queued change is replayed once with its original opId when the socket returns.
 */
export class LiveConnection {
  private socket: WebSocket | null = null;
  private offlineTimer: number | null = null;
  private retryTimer: number | null = null;
  private savedTimer: number | null = null;
  private lastCursor = 0;
  private stopped = false;
  private replaying = false;
  /** True between the server's hello and the socket closing. */
  private live = false;

  constructor(
    private readonly state: WorkspaceState,
    private readonly handlers: LiveHandlers,
  ) {}

  start(): void {
    this.open();
    // The browser telling us it is offline is as good a signal as a dropped socket.
    window.addEventListener('offline', () => this.dropSocket());
    window.addEventListener('online', () => {
      if (this.state.connection === 'offline') this.open();
    });
  }

  /** Treats the socket as unreachable, so edits queue and the offline banner is due. */
  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.live = false;
    socket?.close();
    this.scheduleRetry();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  }

  /** A socket counts as connected only once the server has answered with the document. */
  get connected(): boolean {
    return this.live && this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  private clearTimers(): void {
    for (const timer of [this.offlineTimer, this.retryTimer, this.savedTimer]) {
      if (timer !== null) window.clearTimeout(timer);
    }
    this.offlineTimer = null;
    this.retryTimer = null;
    this.savedTimer = null;
  }

  private open(): void {
    if (this.stopped || this.state.connection === 'ended') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws?diagram=${encodeURIComponent(this.state.diagramId)}`,
    );
    this.socket = socket;
    if (this.offlineTimer === null && this.state.connection === 'live') {
      this.offlineTimer = window.setTimeout(() => {
        this.offlineTimer = null;
        if (!this.connected) {
          this.state.connection = 'offline';
          this.handlers.onChange();
        }
      }, OFFLINE_AFTER_MS);
    }

    socket.addEventListener('message', (event) => {
      this.receive(JSON.parse(String(event.data)) as Record<string, unknown>);
    });

    socket.addEventListener('close', (event) => {
      this.socket = null;
      this.live = false;
      if (event.code === 4404) {
        this.handlers.onNotFound();
        return;
      }
      if (event.code === 4401) {
        this.state.connection = 'ended';
        this.handlers.onSessionEnded();
        this.handlers.onChange();
        return;
      }
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.stopped || this.state.connection === 'ended') return;
    if (this.state.connection === 'offline') this.handlers.onChange();
    if (this.offlineTimer === null && this.state.connection !== 'offline') {
      this.offlineTimer = window.setTimeout(() => {
        this.offlineTimer = null;
        if (!this.connected) {
          this.state.connection = 'offline';
          this.handlers.onChange();
        }
      }, OFFLINE_AFTER_MS);
    }
    if (this.retryTimer !== null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, RETRY_EVERY_MS);
  }

  /** Called after a successful sign-in from the Sign in to continue dialog. */
  resume(): void {
    this.state.connection = 'live';
    this.open();
  }

  private receive(message: Record<string, unknown>): void {
    switch (message['t']) {
      case 'hello':
        this.handleHello(message as unknown as HelloMessage);
        break;
      case 'op':
        this.handleOp(message);
        break;
      case 'ack':
        this.handleAck(message);
        break;
      case 'opError':
        this.handleOpError(message);
        break;
      case 'undoSkipped':
        this.handleUndoSkipped(message);
        break;
      case 'replaced':
        this.handleReplaced(message);
        break;
      case 'presence':
        this.handlePresence(message);
        break;
      case 'cursor':
        this.handleCursor(message);
        break;
      case 'cursorGone':
        this.state.cursors.delete(String(message['userId']));
        this.handlers.onChange();
        break;
      case 'role':
        this.handlers.onRoleChange(message['role'] as Role);
        break;
      case 'comments':
        this.handlers.onCommentsChanged();
        break;
      case 'versions':
        this.handlers.onVersionsChanged();
        break;
      case 'members':
        this.handlers.onMembersChanged();
        break;
      case 'exports':
        this.handlers.onExportsChanged();
        break;
      default:
        break;
    }
  }

  /** The connection counts as live once the server has answered with the document. */
  private handleHello(message: HelloMessage): void {
    if (this.offlineTimer !== null) {
      window.clearTimeout(this.offlineTimer);
      this.offlineTimer = null;
    }
    this.live = true;
    this.state.connection = 'live';
    this.handlers.onHello(message);
    void this.replayQueue();
  }

  private handleOp(message: Record<string, unknown>): void {
    const pages = (message['pages'] ?? []) as Page[];
    const removed = (message['removedPages'] ?? []) as string[];
    const order = (message['order'] ?? []) as { id: string; order: number }[];
    const document = this.state.document;
    document.seq = Number(message['seq'] ?? document.seq);
    document.pages = document.pages.filter((page) => !removed.includes(page.id));
    for (const page of pages) {
      const index = document.pages.findIndex((candidate) => candidate.id === page.id);
      if (index >= 0) document.pages[index] = page;
      else document.pages.push(page);
    }
    for (const entry of order) {
      const page = findPage(document, entry.id);
      if (page) page.order = entry.order;
    }
    recomputeRoutes(this.state);
    const actor = message['actor'] as { id: string; name: string } | undefined;
    if (message['kind'] === 'restore_version' && actor && actor.id !== this.state.me.id) {
      this.handlers.onRestored(actor.name, String(message['versionName'] ?? ''));
    }
    if (actor && actor.id !== this.state.me.id) {
      this.handlers.onRemoteChange(pages.map((page) => page.id));
    } else {
      this.handlers.onChange();
    }
  }

  private handleAck(message: Record<string, unknown>): void {
    const opId = String(message['opId']);
    const pending = this.state.pending.get(opId);
    this.state.pending.delete(opId);
    const rerouted = (message['rerouted'] ?? []) as string[];
    if (pending && !pending.replayed && pending.announce.kind === 'moved') {
      announce(copy.movedNotice(pending.announce.label, rerouted.length));
    }
    pending?.onAck?.((message['ids'] ?? {}) as Record<string, string>);
    this.handlers.onChange();
  }

  private handleOpError(message: Record<string, unknown>): void {
    const opId = String(message['opId']);
    const pending = this.state.pending.get(opId);
    this.state.pending.delete(opId);
    const code = String(message['code']);
    const by = typeof message['by'] === 'string' ? message['by'] : '';
    const label = pending ? Object.values(pending.labels)[0] ?? '' : '';
    if (code === 'shape_deleted' || code === 'connector_deleted') {
      announce(copy.deletedNotice(label, by));
    } else if (code === 'forbidden_role') {
      announce(copy.roleNotice);
    }
    this.handlers.onChange();
  }

  private handleUndoSkipped(message: Record<string, unknown>): void {
    const opId = String(message['opId']);
    this.state.pending.delete(opId);
    const page = currentPage(this.state);
    const shapeId = message['shape'];
    const shape = typeof shapeId === 'string' ? findShape(page, shapeId) : undefined;
    announce(copy.cantUndoNotice(String(message['by']), shape ? shapeLabel(shape) : ''));
    this.handlers.onChange();
  }

  private handleReplaced(message: Record<string, unknown>): void {
    const page = currentPage(this.state);
    const shapeId = message['shape'];
    const shape = typeof shapeId === 'string' ? findShape(page, shapeId) : undefined;
    announce(copy.replacedNotice(String(message['by']), shape ? shapeLabel(shape) : ''));
  }

  private handlePresence(message: Record<string, unknown>): void {
    const list = (message['list'] ?? []) as PresencePerson[];
    this.state.presence = list.filter((person) => person.userId !== this.state.me.id);
    const joined = message['joined'] as PresencePerson | undefined;
    if (joined && joined.userId !== this.state.me.id) announce(copy.joinedNotice(joined.name));
    for (const userId of [...this.state.cursors.keys()]) {
      if (!this.state.presence.some((person) => person.userId === userId)) {
        this.state.cursors.delete(userId);
      }
    }
    this.handlers.onChange();
  }

  private handleCursor(message: Record<string, unknown>): void {
    const userId = String(message['userId']);
    const x = Number(message['x']);
    const y = Number(message['y']);
    const existing = this.state.cursors.get(userId);
    this.state.cursors.set(userId, {
      userId,
      name: String(message['name']),
      page: String(message['page']),
      x,
      y,
      drawnX: existing?.drawnX ?? x,
      drawnY: existing?.drawnY ?? y,
    });
    this.handlers.onChange();
  }

  sendCursor(page: string, x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastCursor < CURSOR_EVERY_MS) return;
    this.lastCursor = now;
    if (this.connected) this.socket?.send(JSON.stringify({ t: 'cursor', page, x, y }));
  }

  /**
   * Applies an operation on the canvas at once and sends it, or queues it when the socket
   * is away or the session has ended.
   */
  send(
    op: Operation,
    announceAs: PendingOperation['announce'] = { kind: 'none' },
    onAck?: (ids: Record<string, string>) => void,
  ): void {
    const opId = newOpId(this.state.me.id);
    const labels = this.labelsFor(op);
    this.applyLocally(op);
    const entry: PendingOperation = {
      opId,
      op,
      announce: announceAs,
      labels,
      replayed: false,
      ...(onAck ? { onAck } : {}),
    };
    if (this.connected) {
      this.state.pending.set(opId, entry);
      this.socket?.send(
        JSON.stringify({ t: 'op', opId, baseSeq: this.state.document.seq, op }),
      );
    } else {
      this.state.queue.push({ opId, baseSeq: this.state.document.seq, op });
      saveQueue(this.state);
    }
    this.handlers.onChange();
  }

  private labelsFor(op: Operation): Record<string, string> {
    const page = currentPage(this.state);
    const labels: Record<string, string> = {};
    const add = (id: string): void => {
      const shape = findShape(page, id);
      if (shape) labels[id] = shapeLabel(shape);
    };
    if ('shape' in op && typeof op.shape === 'string') add(op.shape);
    if ('shapes' in op) {
      for (const entry of op.shapes) add(typeof entry === 'string' ? entry : entry.shape);
    }
    return labels;
  }

  /** Edits show at once, so the operation is applied to the local document first. */
  private applyLocally(op: Operation): void {
    if (op.kind === 'undo' || op.kind === 'redo' || op.kind === 'restore_version') return;
    try {
      applyOperation(shownDocument(this.state), op, { mintId: localId });
      recomputeRoutes(this.state);
    } catch {
      // The server decides; a refusal arrives as an operation error and rolls back.
    }
  }

  /** Replays the queue in order with the original opIds, each accepted exactly once. */
  private async replayQueue(): Promise<void> {
    if (this.replaying) return;
    this.replaying = true;
    let replayed = 0;
    try {
      while (this.state.queue.length > 0 && this.connected) {
        const entry = this.state.queue[0];
        if (!entry) break;
        this.state.pending.set(entry.opId, {
          opId: entry.opId,
          op: entry.op,
          announce: { kind: 'none' },
          labels: this.labelsFor(entry.op),
          replayed: true,
        });
        this.socket?.send(
          JSON.stringify({ t: 'op', opId: entry.opId, baseSeq: entry.baseSeq, op: entry.op }),
        );
        this.state.queue.shift();
        replayed += 1;
        saveQueue(this.state);
        this.handlers.onChange();
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      if (replayed > 0 && this.state.queue.length === 0) this.showSavedBanner();
    } finally {
      this.replaying = false;
    }
  }

  /** Once the queue is empty the saved banner shows for 3 seconds of page time. */
  private showSavedBanner(): void {
    if (this.savedTimer !== null) window.clearTimeout(this.savedTimer);
    this.state.savedBanner = true;
    this.handlers.onChange();
    this.savedTimer = window.setTimeout(() => {
      this.savedTimer = null;
      this.state.savedBanner = false;
      this.handlers.onChange();
    }, SAVED_BANNER_MS);
  }
}

let localCounter = 0;

/** Ids the browser mints for an offline edit, replaced when the server broadcasts. */
function localId(prefix: 'p' | 'l' | 's' | 'c' | 'g'): string {
  localCounter += 1;
  return `${prefix}_local${String(localCounter).padStart(6, '0')}`;
}
