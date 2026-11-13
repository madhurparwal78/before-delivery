type Listener = (message: Record<string, unknown>) => void;

/**
 * The socket treats silence of more than 5 seconds as a lost connection and reconnects.
 * The tab's reconnect token lets a reloaded tab rejoin its seat.
 */
export class Socket {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<(online: boolean) => void>();
  private silence: number | null = null;
  private retry: number | null = null;
  private closed = false;
  private online = false;

  constructor(private readonly query: () => string) {}

  open(): void {
    this.closed = false;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws${this.query()}`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.setOnline(true);
      this.armSilence();
    });
    ws.addEventListener('message', (event) => {
      this.armSilence();
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (payload === null || typeof payload !== 'object') return;
      const message = payload as Record<string, unknown>;
      if (message.type === 'ping') {
        this.send({ type: 'pong' });
        return;
      }
      if (typeof message.reconnectToken === 'string') {
        window.sessionStorage.setItem('dc_seat_token', message.reconnectToken);
      }
      for (const listener of [...this.listeners]) listener(message);
    });
    ws.addEventListener('close', () => {
      this.setOnline(false);
      this.scheduleRetry();
    });
    ws.addEventListener('error', () => ws.close());
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    for (const listener of this.statusListeners) listener(online);
  }

  private armSilence(): void {
    if (this.silence !== null) window.clearTimeout(this.silence);
    this.silence = window.setTimeout(() => {
      this.setOnline(false);
      this.ws?.close();
    }, 5000);
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry !== null) return;
    this.retry = window.setTimeout(() => {
      this.retry = null;
      this.connect();
    }, 700);
  }

  send(message: Record<string, unknown>): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (online: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    if (this.silence !== null) window.clearTimeout(this.silence);
    if (this.retry !== null) window.clearTimeout(this.retry);
    this.ws?.close();
    this.ws = null;
  }
}

export function seatToken(): string | null {
  return window.sessionStorage.getItem('dc_seat_token');
}
