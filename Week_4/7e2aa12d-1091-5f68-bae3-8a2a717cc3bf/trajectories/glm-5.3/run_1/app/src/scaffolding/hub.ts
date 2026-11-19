// The live socket connections of editors and view pages, and the presence keys behind them.
import type WebSocket from 'ws';
import type { LiveMessage } from './live.js';
import type { Valkey } from './valkey.js';

export interface Connection {
  layoutId: string;
  username: string | null;
  send: (message: LiveMessage) => void;
  presenceTimer: NodeJS.Timeout | null;
  sock: WebSocket;
}

export class LiveHub {
  private connections: Connection[] = [];
  constructor(private valkey: Valkey, private presenceSeconds: number) {}

  add(conn: Omit<Connection, 'presenceTimer'>): void {
    const connection: Connection = { ...conn, presenceTimer: null };
    this.connections.push(connection);
    if (connection.username) {
      // Set the presence key first, then announce the new list to everyone.
      void this.valkey.setPresence(connection.layoutId, connection.username, this.presenceSeconds)
        .then(() => this.broadcastPresence(connection.layoutId));
      connection.presenceTimer = setInterval(() => {
        void this.valkey.setPresence(connection.layoutId, connection.username as string, this.presenceSeconds);
      }, Math.max(1, Math.floor(this.presenceSeconds / 3)));
    }
  }

  remove(sock: WebSocket): void {
    const index = this.connections.findIndex((c) => c.sock === sock);
    if (index < 0) return;
    const [conn] = this.connections.splice(index, 1);
    if (conn.presenceTimer) clearInterval(conn.presenceTimer);
    if (conn.username) {
      void this.valkey.delPresence(conn.layoutId, conn.username);
      void this.broadcastPresence(conn.layoutId);
    }
  }

  push(layoutId: string, message: LiveMessage): void {
    for (const conn of this.connections) {
      if (conn.layoutId === layoutId) {
        try { conn.send(message); } catch {}
      }
    }
  }

  async presence(layoutId: string): Promise<string[]> {
    const local = this.connections
      .filter((c) => c.layoutId === layoutId && c.username !== null)
      .map((c) => c.username as string);
    const remote = await this.valkey.listPresence(layoutId);
    return [...new Set(local.concat(remote))].sort();
  }

  async broadcastPresence(layoutId: string): Promise<void> {
    this.pushPresence(layoutId, await this.presence(layoutId));
  }

  private pushPresence(layoutId: string, usernames: string[]): void {
    this.push(layoutId, {
      layoutId, kind: 'presence', revision: 0, username: '', announcement: null, usernames,
    });
  }
}
