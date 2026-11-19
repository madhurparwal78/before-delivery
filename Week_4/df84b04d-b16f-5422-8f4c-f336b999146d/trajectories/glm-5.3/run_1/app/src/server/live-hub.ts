import { connect, type RedisClient } from './valkey.js';
import type { Config } from './config.js';
import { WebSocket } from 'ws';

export interface LiveSocketInfo {
  socket: WebSocket;
  ownerId: string;
  accountId: string;
  rootId: string | null;
  since: number;
  branch: Set<string>;
}

export class LiveHub {
  private client: RedisClient | null = null;
  private connecting = false;
  private sockets = new Map<WebSocket, LiveSocketInfo>();

  constructor(private config: Config, private valkeyUrl: string) {}

  async ensureClient(): Promise<RedisClient | null> {
    if (this.client && this.client.isOpen) return this.client;
    if (this.connecting) return null;
    this.connecting = true;
    try {
      this.client = await connect(this.valkeyUrl);
      this.client.onClose(() => {
        this.client = null;
      });
    } catch {
      this.client = null;
    } finally {
      this.connecting = false;
    }
    return this.client;
  }

  async append(ownerId: string, seq: number, message: Record<string, unknown>): Promise<void> {
    const client = await this.ensureClient();
    if (!client) return;
    try {
      const key = `twig:outline:${ownerId}:changes`;
      await client.xadd(key, `${seq}-0`, { seq: String(seq), change: JSON.stringify(message) });
      await client.xtrim(key, this.config.streamMaxlen);
    } catch {
      this.client = null;
    }
  }

  async readSince(ownerId: string, since: number): Promise<{ reload: boolean; messages: string[] }> {
    const client = await this.ensureClient();
    if (!client) return { reload: false, messages: [] };
    try {
      const key = `twig:outline:${ownerId}:changes`;
      const entries = await client.xrange(key, `(${since}-0`, '+', 500);
      const messages: string[] = [];
      for (const entry of entries) {
        messages.push(entry.fields.change);
      }
      const oldestAvailable = await client.xrange(key, '-', '+', 1);
      if (oldestAvailable.length > 0) {
        const oldestSeq = Number(String(oldestAvailable[0]?.id).split('-')[0]);
        if (since > 0 && since + 1 < oldestSeq) {
          return { reload: true, messages: [] };
        }
      }
      return { reload: false, messages };
    } catch {
      this.client = null;
      return { reload: false, messages: [] };
    }
  }

  async fanoutOk(): Promise<boolean> {
    const client = await this.ensureClient();
    return client !== null;
  }

  register(socket: WebSocket, info: LiveSocketInfo): void {
    this.sockets.set(socket, info);
    socket.on('close', () => {
      this.sockets.delete(socket);
    });
  }

  unregister(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  emit(ownerId: string, message: Record<string, unknown>, branchOf: (info: LiveSocketInfo) => Set<string> | null): void {
    const text = JSON.stringify(message);
    for (const [socket, info] of this.sockets) {
      if (info.ownerId !== ownerId) continue;
      const branch = branchOf(info);
      if (branch === null) continue;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(text);
      }
    }
  }

  emitAll(ownerId: string, message: Record<string, unknown>): void {
    const text = JSON.stringify(message);
    for (const [socket, info] of this.sockets) {
      if (info.ownerId !== ownerId) continue;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(text);
      }
    }
  }

  revokeFor(ownerId: string, bulletId: string): void {
    const text = JSON.stringify({ type: 'revoked' });
    for (const [socket, info] of this.sockets) {
      if (info.ownerId !== ownerId) continue;
      if (info.rootId === bulletId) {
        if (socket.readyState === WebSocket.OPEN) socket.send(text);
        socket.close();
        this.sockets.delete(socket);
      }
    }
  }

  infoFor(socket: WebSocket): LiveSocketInfo | undefined {
    return this.sockets.get(socket);
  }

  socketCount(): number {
    return this.sockets.size;
  }

  allSockets(): [WebSocket, LiveSocketInfo][] {
    return [...this.sockets.entries()];
  }
}
