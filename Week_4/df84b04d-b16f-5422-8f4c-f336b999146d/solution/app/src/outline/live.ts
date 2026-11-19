import type { LiveMessage } from "../../shared/types";

const RECONNECT_MS = [300, 600, 1200, 2000];
const DEFAULT_PAUSE_SECONDS = 5;

interface LiveHandlers {
  onMessage: (message: LiveMessage) => void;
  /** True while live fan-out has been missing for the pause window; false when it is back. */
  onPaused: (paused: boolean) => void;
  seq: () => number;
}

/** One socket per tab and view. Reconnects with the last seen sequence number and tracks the pause window. */
export class LiveLink {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private pauseSeconds = DEFAULT_PAUSE_SECONDS;
  private paused = false;
  private healthy = false;

  constructor(private readonly root: string | null, private readonly handlers: LiveHandlers) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const root = this.root === null ? "home" : encodeURIComponent(this.root);
    const socket = new WebSocket(`${scheme}://${location.host}/api/live?root=${root}&since=${this.handlers.seq()}`);
    this.socket = socket;
    socket.onopen = () => { this.attempt = 0; };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as LiveMessage;
      if (message.type === "heartbeat") {
        if (message.pauseAfterSeconds !== undefined) this.pauseSeconds = message.pauseAfterSeconds;
        this.setHealthy(message.fanout === "ok");
      }
      this.handlers.onMessage(message);
      if (message.type === "revoked" || message.type === "reload") this.socket?.close();
    };
    socket.onclose = () => {
      if (this.closed) return;
      this.setHealthy(false);
      const delay = RECONNECT_MS[Math.min(this.attempt, RECONNECT_MS.length - 1)] ?? 2000;
      this.attempt += 1;
      this.retry = setTimeout(() => this.connect(), delay);
    };
    this.setHealthy(this.healthy);
  }

  private setHealthy(healthy: boolean): void {
    this.healthy = healthy;
    if (healthy) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
      if (this.paused) {
        this.paused = false;
        this.handlers.onPaused(false);
      }
    } else if (this.pauseTimer === undefined && !this.paused) {
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = undefined;
        this.paused = true;
        this.handlers.onPaused(true);
      }, this.pauseSeconds * 1000);
    }
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    clearTimeout(this.pauseTimer);
    this.socket?.close();
  }
}
