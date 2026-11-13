import type { ServerResponse } from 'node:http';
import type { SessionInfo } from './http.js';

// The same-origin live channel: Server-Sent Events.

export interface LiveEvent {
  kind: string;
  payload: unknown;
}

export interface LiveConnection {
  id: number;
  res: ServerResponse;
  token: string | null;
  topics: Set<string>;
  send: (event: LiveEvent) => void;
  close: () => void;
}

export class LiveHub {
  private nextId = 1;
  private readonly connections = new Map<number, LiveConnection>();
  private readonly byToken = new Map<string, Set<number>>();
  /** A hook the room engine sets to release a seat when a connection closes. */
  onConnectionClosed: ((connection: LiveConnection) => void) | null = null;

  open(res: ServerResponse, token: string | null, topics: string[]): LiveConnection {
    const id = this.nextId++;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(':ok\n\n');
    const connection: LiveConnection = {
      id,
      res,
      token,
      topics: new Set(topics),
      send: (event) => {
        try {
          res.write(`event: live\ndata: ${JSON.stringify(event)}\n\n`);
        } catch {
          this.close(id);
        }
      },
      close: () => this.close(id),
    };
    this.connections.set(id, connection);
    if (token !== null) {
      const set = this.byToken.get(token) ?? new Set<number>();
      set.add(id);
      this.byToken.set(token, set);
    }
    res.on('close', () => this.close(id));
    return connection;
  }

  private close(id: number): void {
    const connection = this.connections.get(id);
    if (connection === undefined) return;
    this.connections.delete(id);
    if (connection.token !== null) {
      const set = this.byToken.get(connection.token);
      if (set !== undefined) {
        set.delete(id);
        if (set.size === 0) this.byToken.delete(connection.token);
      }
    }
    try { connection.res.end(); } catch { /* already closed */ }
    this.onConnectionClosed?.(connection);
  }

  broadcast(topic: string, event: LiveEvent): void {
    for (const connection of this.connections.values()) {
      if (connection.topics.has(topic)) connection.send(event);
    }
  }

  sendToToken(token: string, event: LiveEvent): void {
    const set = this.byToken.get(token);
    if (set === undefined) return;
    for (const id of set) {
      const connection = this.connections.get(id);
      if (connection !== undefined) connection.send(event);
    }
  }

  closeToken(token: string): void {
    const set = this.byToken.get(token);
    if (set === undefined) return;
    for (const id of Array.from(set)) this.close(id);
  }

  hasToken(token: string): boolean {
    const set = this.byToken.get(token);
    return set !== undefined && set.size > 0;
  }

  connectionsForToken(token: string): LiveConnection[] {
    const set = this.byToken.get(token);
    if (set === undefined) return [];
    return Array.from(set).map((id) => this.connections.get(id)).filter((c): c is LiveConnection => c !== undefined);
  }

  disconnect(session: SessionInfo): void {
    this.closeToken(session.token);
  }
}

export function boardTopic(board: string, length: number): string {
  return `board:${board}:${length}`;
}
