import type { Bullet, LiveMessage } from '../../shared/types.js';

export interface LiveHandlers {
  onChange(bullets: Bullet[], removed: string[], seq: number): void;
  onReload(): void;
  onRevoked(): void;
  onPaused(paused: boolean): void;
}

/** The tab's live link: one socket, a pause watchdog and catch-up on reconnect. */
export class LiveLink {
  private socket: WebSocket | null = null;
  private seq: number;
  private pauseAfterSeconds = 5;
  private lastOk = Date.now();
  private paused = false;
  private stopped = false;
  private watchdog = 0;

  constructor(
    private readonly rootId: string | null,
    seq: number,
    private readonly handlers: LiveHandlers
  ) {
    this.seq = seq;
  }

  start(): void {
    this.open();
    this.watchdog = window.setInterval(() => this.check(), 400);
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.watchdog);
    this.socket?.close();
    this.socket = null;
  }

  seen(seq: number): void {
    if (seq > this.seq) this.seq = seq;
  }

  private check(): void {
    const closed = this.socket === null || this.socket.readyState !== WebSocket.OPEN;
    const late = Date.now() - this.lastOk > this.pauseAfterSeconds * 1_000;
    const paused = closed || late;
    if (paused !== this.paused) {
      this.paused = paused;
      this.handlers.onPaused(paused);
    }
  }

  private open(): void {
    if (this.stopped) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const root = this.rootId === null ? '' : `root=${encodeURIComponent(this.rootId)}&`;
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/live?${root}since=${this.seq}`
    );
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as LiveMessage;
      if (message.type === 'heartbeat') {
        if (message.pauseAfterSeconds !== undefined) {
          this.pauseAfterSeconds = message.pauseAfterSeconds;
        }
        if (message.fanout === 'ok') this.lastOk = Date.now();
        this.check();
        return;
      }
      if (message.type === 'change') {
        this.lastOk = Date.now();
        this.seen(message.seq);
        this.handlers.onChange(message.bullets, message.removed, message.seq);
        this.check();
        return;
      }
      if (message.type === 'reload') {
        this.lastOk = Date.now();
        this.handlers.onReload();
        return;
      }
      this.handlers.onRevoked();
    });
    socket.addEventListener('close', () => {
      if (this.stopped) return;
      this.socket = null;
      window.setTimeout(() => this.open(), 1_000);
    });
    socket.addEventListener('error', () => socket.close());
  }
}
