import type { ClientMessage, ServerMessage } from "../shared/protocol";

const RECONNECT_MS = 2000;

/** The page's one WebSocket to `/ws`: queues messages until open and reconnects after a drop. */
export class LiveSocket {
  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private closed = false;
  private retry = 0;

  constructor(
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onOpen: () => void = () => undefined,
  ) {
    this.connect();
  }

  private connect(): void {
    const socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.onOpen();
      for (const message of this.queue.splice(0)) socket.send(JSON.stringify(message));
    });
    socket.addEventListener("message", (event) => this.onMessage(JSON.parse(String(event.data)) as ServerMessage));
    socket.addEventListener("close", () => {
      if (!this.closed) this.retry = window.setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else this.queue.push(message);
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.retry);
    this.socket?.close();
  }
}
