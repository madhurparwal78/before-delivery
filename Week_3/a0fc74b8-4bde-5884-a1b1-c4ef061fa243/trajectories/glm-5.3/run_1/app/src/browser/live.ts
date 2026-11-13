/** Same-origin live channel: WebSocket at /live, falling back to nothing (no polling faster than the channel). */

type Listener = (payload: LiveMessage) => void;

export interface LiveMessage {
  type: string;
  id?: string;
  mailOk?: boolean;
  storageOk?: boolean;
  role?: string;
  userId?: string;
}

export class LiveChannel {
  private ws: WebSocket | null = null;
  private listeners: Listener[] = [];
  private closed = false;

  constructor(private query: string) {}

  connect(): void {
    if (this.closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/live?${this.query}`);
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as LiveMessage;
        for (const fn of this.listeners) fn(data);
      } catch { /* ignore malformed */ }
    };
    this.ws.onclose = () => {
      if (this.closed) return;
      setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => { /* close handler reconnects */ };
  }

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
