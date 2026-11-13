import type { LiveMessage } from "../../shared/types";

const BACKOFF_MS = [1000, 2000, 4000, 8000];

/** One WebSocket for the page: reconnects with backoff, and sends nothing until it is open. */
export class LiveSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private stopped = false;
  private readonly messageHandlers = new Set<(message: LiveMessage) => void>();
  private readonly openHandlers = new Set<() => void>();
  private readonly closeHandlers = new Set<(code: number) => void>();

  constructor(private readonly query = "") {}

  onMessage(handler: (message: LiveMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /** Runs on every open, first connection and reconnections alike. */
  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler);
    if (this.isOpen) handler();
    return () => this.openHandlers.delete(handler);
  }

  onClose(handler: (code: number) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.stopped = false;
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${window.location.host}/api/live${this.query}`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      for (const handler of this.openHandlers) handler();
    };
    ws.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as LiveMessage;
      for (const handler of this.messageHandlers) handler(message);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const handler of this.closeHandlers) handler(event.code);
      if (!this.stopped && event.code !== 4401 && event.code !== 4410) this.schedule();
    };
  }

  private schedule(): void {
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 8000;
    this.attempt += 1;
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  send(message: unknown): void {
    if (this.isOpen) this.ws?.send(JSON.stringify(message));
  }

  close(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
