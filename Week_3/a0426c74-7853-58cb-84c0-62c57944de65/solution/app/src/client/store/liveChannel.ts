// The live socket of one drawing: hello with the last sequence number, in-order delivery, a refetch request on a gap or a
// numbering that went back, and reconnection on page timers. Knows nothing about what the messages mean.
import type { LiveClientMessage, LiveMessage } from '../../shared/types.ts';

/** What a socket reports; the page wires them to a `WebSocket`, tests to a fake. */
export interface LiveHandlers {
  open(): void;
  message(data: string): void;
  close(): void;
}

export interface LiveSocket {
  send(data: string): void;
  close(): void;
}

interface LiveEvents {
  /** the socket is open and the hello was sent */
  opened?(): void;
  /** the socket closed by itself; a reconnect is scheduled */
  lost?(): void;
  /** every message exactly once, in sequence order */
  message(message: LiveMessage): void;
  /** a message was missed or the numbering went back: the page must reload the document, then call `resynced(seq)` */
  resync(): void;
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000];

export class LiveChannel {
  private socket: LiveSocket | null = null;
  private open = false;
  private lastSeq = 0;
  private resyncing = false;
  private buffered: LiveMessage[] = [];
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;

  constructor(
    private readonly path: string,
    private readonly openSocket: (path: string, handlers: LiveHandlers) => LiveSocket,
    private readonly events: LiveEvents,
  ) {}

  /** Opens the socket and says hello since `seq`; reconnects by itself until `disconnect`. */
  connect(seq: number): void {
    this.lastSeq = seq;
    this.wanted = true;
    this.attempt();
  }

  /** Closes on purpose (working offline, page closed): no reconnect. */
  disconnect(): void {
    this.wanted = false;
    this.open = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The number of the last message delivered. */
  get seq(): number {
    return this.lastSeq;
  }

  send(message: LiveClientMessage): void {
    if (this.open) this.socket?.send(JSON.stringify(message));
  }

  /** The document was (re)loaded and already holds everything up to `seq`: carry on from there with what arrived meanwhile. */
  resynced(seq: number): void {
    this.lastSeq = seq;
    this.resyncing = false;
    const waiting = this.buffered;
    this.buffered = [];
    for (const message of waiting) if (message.seq > seq) this.receive(message);
  }

  private attempt(): void {
    this.timer = null;
    let socket: LiveSocket | null = null;
    const current = (): boolean => this.socket === socket;
    socket = this.openSocket(this.path, {
      open: () => {
        if (!current()) return;
        this.open = true;
        this.attempts = 0;
        socket?.send(JSON.stringify({ type: 'hello', since: this.lastSeq } satisfies LiveClientMessage));
        this.events.opened?.();
      },
      message: (data) => {
        if (current()) this.receive(JSON.parse(data) as LiveMessage); // the wire format is typed by `LiveMessage`
      },
      close: () => {
        if (!current()) return;
        this.open = false;
        this.socket = null;
        if (!this.wanted) return;
        this.events.lost?.();
        this.timer = setTimeout(() => this.attempt(), RECONNECT_DELAYS_MS[Math.min(this.attempts++, RECONNECT_DELAYS_MS.length - 1)]);
      },
    });
    this.socket = socket;
  }

  private receive(message: LiveMessage): void {
    if (this.resyncing) {
      this.buffered.push(message);
      return;
    }
    if (message.seq === this.lastSeq + 1) {
      this.lastSeq = message.seq;
      this.events.message(message);
      return;
    }
    this.resyncing = true;
    this.buffered = [message];
    this.events.resync();
  }
}
