export type ServerFrame =
  | { type: 'joined'; ref: string; documentId: string; revision: number; role: string; mode: 'editing' | 'suggesting' | 'viewing'; accessEndsAt: string | null; people: { person: { personId: string; displayName: string; colour: string; role?: string }; state: 'active' | 'idle' }[] }
  | { type: 'ack'; ref: string; revision?: number; count?: number; applied?: boolean; status?: string }
  | { type: 'error'; ref: string; code: string; fields?: Record<string, string> }
  | { type: 'op'; revision: number; authorId: string; mode: string; ops: unknown[] }
  | { type: 'card_added'; card: Record<string, unknown> }
  | { type: 'card_changed'; card: Record<string, unknown> }
  | { type: 'card_closed'; cardId: string; status: string; decidedBy: { personId: string; displayName: string; colour: string; role?: string } | null }
  | { type: 'caret'; person: { personId: string; displayName: string; colour: string; role?: string }; at: number; length: number }
  | { type: 'presence'; person: { personId: string; displayName: string; colour: string; role?: string }; state: 'active' | 'idle' | 'left' }
  | { type: 'saved'; revision: number }
  | { type: 'save_failed'; revision: number }
  | { type: 'role_changed'; role: string; mode: 'editing' | 'suggesting' | 'viewing' }
  | { type: 'title_changed'; title: string; client: string }
  | { type: 'access_ended'; reason: 'expired' | 'removed' | 'deleted' }
  | { type: 'notice'; notice: Record<string, unknown> }
  | { type: 'lists_changed' };

/** One socket per page, at /api/socket on the same origin. */
export class LiveSocket {
  private ws: WebSocket | null = null;
  private ref = 0;
  private pending = new Map<string, { resolve: (f: ServerFrame) => void; reject: (e: Error) => void }>();
  /** frames waiting for the socket to open */
  private outbox: { payload: string }[] = [];
  private intentionalClose = false;
  connected = false;
  onFrame: (f: ServerFrame) => void = () => undefined;
  onDisconnect: () => void = () => undefined;
  onReconnect: () => void = () => undefined;

  connect(): void {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.intentionalClose = false;
    this.ws = new WebSocket(`${proto}//${window.location.host}/api/socket`);
    this.ws.onopen = () => {
      const reconnected = this.connected;
      this.connected = true;
      for (const item of this.outbox) this.ws?.send(item.payload);
      this.outbox = [];
      if (reconnected) this.onReconnect();
    };
    this.ws.onmessage = (ev) => {
      const frame = JSON.parse(ev.data as string) as ServerFrame;
      const ref = (frame as { ref?: string }).ref;
      if (ref !== undefined) {
        const p = this.pending.get(ref);
        if (p) {
          this.pending.delete(ref);
          if (frame.type === 'error') p.reject(new Error(frame.code));
          else p.resolve(frame);
        }
      }
      this.onFrame(frame);
    };
    this.ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      if (this.intentionalClose) return;
      if (was) {
        this.onDisconnect();
        window.setTimeout(() => this.connect(), 1200);
      } else {
        window.setTimeout(() => this.connect(), 500);
      }
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send<T extends ServerFrame>(frame: Record<string, unknown>): Promise<T> {
    const ref = `r${++this.ref}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(ref, { resolve: resolve as (f: ServerFrame) => void, reject });
      const payload = JSON.stringify({ ...frame, ref });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(payload);
      } else {
        this.outbox.push({ payload });
      }
      window.setTimeout(() => {
        if (this.pending.has(ref)) {
          this.pending.delete(ref);
          reject(new Error('timeout'));
        }
      }, 8000);
    });
  }

  close(): void {
    this.intentionalClose = true;
    this.ws?.close();
    this.ws = null;
  }
}

export const socket = new LiveSocket();

/** The heartbeat keeps the socket alive; it is sent every 15 seconds. */
export function startHeartbeat(): void {
  window.setInterval(() => {
    void socket.send({ type: 'heartbeat' }).catch(() => undefined);
  }, 15_000);
}
