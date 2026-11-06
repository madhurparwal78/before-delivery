import type { ClientFrame, ServerFrame } from '../shared/types.js';

type Handler = (frame: ServerFrame) => void;

type Unsent<T> = T extends { ref: string } ? Omit<T, 'ref'> & { ref?: string } : never;

interface Waiter {
  resolve: (frame: ServerFrame) => void;
  reject: (frame: ServerFrame) => void;
}

/** One socket per page. It reconnects, and reports the connection state to the page. */
export class Connection {
  private socket: WebSocket | null = null;
  private refCounter = 0;
  private readonly waiters = new Map<string, Waiter>();
  private readonly handlers: Handler[] = [];
  private readonly stateHandlers: ((connected: boolean) => void)[] = [];
  private closedForGood = false;
  private rejoin: (() => void) | null = null;

  constructor() {
    this.connect();
  }

  onFrame(handler: Handler): void {
    this.handlers.push(handler);
  }

  onConnectionChange(handler: (connected: boolean) => void): void {
    this.stateHandlers.push(handler);
  }

  setRejoin(rejoin: () => void): void {
    this.rejoin = rejoin;
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.closedForGood) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/socket`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      for (const handler of this.stateHandlers) handler(true);
      if (this.rejoin) this.rejoin();
    });
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      if ('ref' in frame && typeof frame.ref === 'string' && this.waiters.has(frame.ref)) {
        const waiter = this.waiters.get(frame.ref) as Waiter;
        this.waiters.delete(frame.ref);
        if (frame.type === 'error') waiter.reject(frame);
        else waiter.resolve(frame);
      }
      for (const handler of this.handlers) handler(frame);
    });
    socket.addEventListener('close', () => {
      if (this.closedForGood) return;
      for (const handler of this.stateHandlers) handler(false);
      for (const waiter of this.waiters.values()) waiter.reject({ type: 'error', ref: '', code: 'conflict' });
      this.waiters.clear();
      if (!this.closedForGood) setTimeout(() => this.connect(), 1_000);
    });
    socket.addEventListener('error', () => undefined);
  }

  close(): void {
    this.closedForGood = true;
    this.socket?.close();
  }

  send(frame: Unsent<ClientFrame>): Promise<ServerFrame> {
    const ref = frame.ref ?? `r${(this.refCounter += 1)}`;
    const payload = { ...frame, ref } as ClientFrame;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject({ type: 'error', ref, code: 'conflict' } satisfies ServerFrame);
    }
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.waiters.set(ref, { resolve, reject });
    });
  }
}
