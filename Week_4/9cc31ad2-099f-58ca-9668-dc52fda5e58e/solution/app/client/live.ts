import type { Push } from "./types";

type Listener = (push: Push) => void;

// The page's one WebSocket to /v1/ws. Listeners get every push for this player; the socket
// reconnects after a drop and tells `onOpen` listeners so they can resubscribe.
class Live {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly openers = new Set<() => void>();
  private retry: number | null = null;

  private connect(): void {
    if (this.socket) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/ws`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("open", () => { for (const opener of this.openers) opener(); });
    socket.addEventListener("message", (event) => {
      const push = JSON.parse(String(event.data)) as Push;
      for (const listener of [...this.listeners]) listener(push);
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      if (this.listeners.size && this.retry === null) {
        this.retry = window.setTimeout(() => {
          this.retry = null;
          this.connect();
        }, 1000);
      }
    });
  }

  listen(listener: Listener): () => void {
    this.listeners.add(listener);
    this.connect();
    return () => { this.listeners.delete(listener); };
  }

  onOpen(opener: () => void): () => void {
    this.openers.add(opener);
    if (this.socket?.readyState === WebSocket.OPEN) opener();
    return () => { this.openers.delete(opener); };
  }

  send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}

export const live = new Live();
