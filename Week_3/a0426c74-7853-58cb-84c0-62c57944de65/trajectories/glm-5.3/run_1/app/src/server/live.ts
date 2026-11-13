import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Live channel: per-drawing sequences, replay after since, broadcast.
// ---------------------------------------------------------------------------

export interface LiveClient {
  socket: WebSocket;
  drawingId: string;
  username: string;
  since: number;
  token: string | null;
  send: (message: unknown) => void;
}

interface QueuedMessage {
  seq: number;
  type: string;
  data: unknown;
}

export class LiveHub {
  private readonly history = new Map<string, QueuedMessage[]>();
  private readonly clients = new Map<WebSocket, LiveClient>();

  attach(client: LiveClient): void {
    this.clients.set(client.socket, client);
    this.replay(client);
  }

  detach(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  private replay(client: LiveClient): void {
    const messages = this.history.get(client.drawingId) ?? [];
    for (const message of messages) {
      if (message.seq > client.since) client.send({ seq: message.seq, type: message.type, data: message.data });
    }
  }

  broadcast(drawingId: string, type: string, data: unknown): number {
    const messages = this.history.get(drawingId) ?? [];
    const seq = messages.length ? messages[messages.length - 1].seq + 1 : 1;
    const queued: QueuedMessage = { seq, type, data };
    messages.push(queued);
    this.history.set(drawingId, messages);
    for (const client of this.clients.values()) {
      if (client.drawingId === drawingId) {
        client.send({ seq, type, data });
      }
    }
    return seq;
  }

  sendToUser(drawingId: string, username: string, type: string, data: unknown): void {
    for (const client of this.clients.values()) {
      if (client.drawingId === drawingId && client.username === username) {
        client.send({ type, data });
      }
    }
  }

  notice(drawingId: string, username: string, message: string): void {
    this.sendToUser(drawingId, username, 'notice', { message });
  }

  presenceUsernames(drawingId: string): string[] {
    const seen = new Set<string>();
    for (const client of this.clients.values()) {
      if (client.drawingId === drawingId) seen.add(client.username);
    }
    return [...seen];
  }
}

export const liveHub = new LiveHub();
