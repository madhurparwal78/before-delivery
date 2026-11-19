export interface LiveFrame {
  id: number;
  event: { kind: string } & Record<string, unknown>;
}

export type LiveHandler = (event: LiveFrame['event']) => void;

/**
 * The one same-origin live connection. Changes are applied inside the message
 * handler, and a dropped connection retries and catches up from the last id
 * so nothing is lost or repeated.
 */
export class LiveConnection {
  private socket: WebSocket | null = null;
  private lastId = 0;
  private retry: number | null = null;
  private readonly handlers = new Set<LiveHandler>();
  private step: number | null = null;

  constructor(
    private readonly guideId: string | null,
    private readonly clientId: string,
  ) {}

  on(handler: LiveHandler): void {
    this.handlers.add(handler);
  }

  start(): void {
    this.connect();
    window.addEventListener('online', () => this.connect());
  }

  reportStep(step: number | null): void {
    this.step = step;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'presence', step }));
    }
  }

  private connect(): void {
    if (this.socket !== null && this.socket.readyState <= WebSocket.OPEN) return;
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/api/live`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'hello',
          since: this.lastId,
          guide: this.guideId,
          step: this.step,
          client: this.clientId,
        }),
      );
    });
    socket.addEventListener('message', (message: MessageEvent<string>) => {
      const frame = JSON.parse(message.data) as LiveFrame;
      if (frame.id > this.lastId) this.lastId = frame.id;
      for (const handler of this.handlers) handler(frame.event);
    });
    socket.addEventListener('close', () => this.scheduleRetry());
    socket.addEventListener('error', () => this.scheduleRetry());
  }

  /** Retries within one second of page time. */
  private scheduleRetry(): void {
    if (this.retry !== null) return;
    this.retry = window.setTimeout(() => {
      this.retry = null;
      this.connect();
    }, 500);
  }
}

export function newClientId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
