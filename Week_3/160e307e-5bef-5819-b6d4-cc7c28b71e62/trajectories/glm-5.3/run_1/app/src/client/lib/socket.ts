/** The same-origin WebSocket connection with heartbeat and reconnect. */
export type ServerMessage = Record<string, unknown> & { type: string };

export class Socket {
  private ws: WebSocket | null = null;
  private lastReceived = 0;
  private reconnectTimer: number | null = null;
  private onMessage: ((msg: ServerMessage) => void) | null = null;
  private onOpen: (() => void) | null = null;
  private queue: string[] = [];

  connect(matchId: string | null, handlers: {
    onMessage: (msg: ServerMessage) => void;
    onOpen?: () => void;
  }): void {
    this.onMessage = handlers.onMessage;
    this.onOpen = handlers.onOpen ?? null;
    this.lastMatchId = matchId;
    this.open(matchId);
  }

  private open(matchId: string | null): void {
    const url = matchId === null ? "/ws" : `/ws?match=${encodeURIComponent(matchId)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.lastReceived = Date.now();
      for (const message of this.queue) ws.send(message);
      this.queue = [];
      if (this.onOpen !== null) this.onOpen();
    };
    ws.onmessage = (event) => {
      this.lastReceived = Date.now();
      let msg: ServerMessage | null = null;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg !== null && this.onMessage !== null) this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setInterval(() => {
          void this.check();
        }, 1000);
      }
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private check(): void {
    if (this.ws !== null && Date.now() - this.lastReceived < 5000) {
      this.ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    // lost: reconnect
    if (this.ws !== null) {
      try {
        this.ws.close();
      } catch {
        // already closing
      }
      this.ws = null;
    }
    this.open(this.lastMatchId);
  }

  private lastMatchId: string | null = null;

  send(message: Record<string, unknown>): void {
    const raw = JSON.stringify(message);
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else {
      this.queue.push(raw);
    }
  }

  close(): void {
    if (this.reconnectTimer !== null) {
      window.clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws !== null) {
      try {
        this.ws.close();
      } catch {
        // already closed
      }
      this.ws = null;
    }
  }
}

export const socket = new Socket();
