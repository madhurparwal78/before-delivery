import type { WebSocket } from 'ws';

export class SocketHub {
  private clients = new Set<WebSocket>();

  add(ws: WebSocket): void {
    this.clients.add(ws);
  }

  remove(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  /** Callers pass an already-serialised JSON string. */
  broadcast(msg: string): void {
    for (const ws of this.clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}
