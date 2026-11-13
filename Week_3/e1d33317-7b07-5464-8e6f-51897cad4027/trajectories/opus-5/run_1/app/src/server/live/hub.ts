import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type {
  HeartbeatMessage,
  PresenceEntry,
  ServerMessage,
} from '../../shared/types.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { broadcast, type ChannelMessage, type PresenceRecord } from '../services/valkey.js';
import type { CollaboratorRow } from '../store/collaborators.js';
import { listHolds, releaseConnectionHolds } from '../store/holds.js';

const PING_INTERVAL_MS = 10_000;
const PONG_GRACE_MS = 10_000;

interface Connection {
  id: string;
  socket: WebSocket;
  scoreId: string;
  collaborator: CollaboratorRow;
  cursor: PresenceEntry['cursor'];
  lastHeartbeat: number;
  lastPong: number;
  seen: number;
}

/** Every live session on this instance, with the presence the server decides. */
class Hub {
  private readonly connections = new Map<string, Connection>();
  private readonly localPresence = new Map<string, Map<string, PresenceRecord>>();

  start(): void {
    broadcast.onMessage((scoreId, message) => void this.receive(scoreId, message));
    broadcast.onLiveChange((live) => {
      for (const connection of this.connections.values()) {
        send(connection.socket, { type: 'live', live });
      }
    });
    setInterval(() => void this.sweep(), 1000).unref();
    setInterval(() => this.pingAll(), PING_INTERVAL_MS).unref();
  }

  private async receive(scoreId: string, message: ChannelMessage): Promise<void> {
    if (message.type === 'close') {
      await this.closeCollaborator(scoreId, message.collaboratorId);
      return;
    }
    for (const connection of this.connections.values()) {
      if (connection.scoreId !== scoreId) continue;
      send(connection.socket, message);
    }
  }

  async add(
    socket: WebSocket,
    scoreId: string,
    collaborator: CollaboratorRow,
    lamport: number,
    lastSeq: number,
  ): Promise<string> {
    const id = randomUUID();
    const connection: Connection = {
      id,
      socket,
      scoreId,
      collaborator,
      cursor: null,
      lastHeartbeat: Date.now(),
      lastPong: Date.now(),
      seen: collaborator.acked_lamport,
    };
    this.connections.set(id, connection);
    await broadcast.subscribe(scoreId);
    send(socket, { type: 'welcome', connectionId: id, lamport, lastSeq, live: broadcast.live });
    send(socket, { type: 'holds', holds: await listHolds(scoreId) });
    socket.on('pong', () => {
      connection.lastPong = Date.now();
    });
    socket.on('message', (raw) => {
      void this.onMessage(connection, raw.toString());
    });
    socket.on('close', () => void this.drop(id));
    socket.on('error', () => void this.drop(id));
    await this.writePresence(connection);
    await this.publishPresence(scoreId);
    return id;
  }

  ownsConnection(collaboratorId: string, connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    return connection !== undefined && connection.collaborator.id === collaboratorId;
  }

  private async onMessage(connection: Connection, raw: string): Promise<void> {
    const message = JSON.parse(raw) as HeartbeatMessage;
    if (message.type !== 'heartbeat') return;
    connection.cursor = message.cursor;
    connection.lastHeartbeat = Date.now();
    if (typeof message.seen === 'number' && message.seen > connection.seen) {
      connection.seen = message.seen;
      await query('update collaborators set acked_lamport = $2 where id = $1', [
        connection.collaborator.id,
        message.seen,
      ]);
    }
    await this.writePresence(connection);
    await this.publishPresence(connection.scoreId);
  }

  private async writePresence(connection: Connection): Promise<void> {
    const record: PresenceRecord = {
      name: connection.collaborator.name,
      role: connection.collaborator.role,
      cursor: connection.cursor,
      at: Date.now(),
    };
    const local = this.localPresence.get(connection.scoreId) ?? new Map();
    local.set(connection.collaborator.id, record);
    this.localPresence.set(connection.scoreId, local);
    await broadcast.writePresence(connection.scoreId, connection.collaborator.id, record);
  }

  async presenceOf(scoreId: string): Promise<PresenceEntry[]> {
    const shared = await broadcast.readPresence(scoreId);
    const source = shared ?? this.localPresence.get(scoreId) ?? new Map<string, PresenceRecord>();
    const cutoff = Date.now() - config.awarenessTtlSeconds * 1000;
    const entries: PresenceEntry[] = [];
    for (const [collaboratorId, record] of source) {
      if (record.at <= cutoff) continue;
      entries.push({
        collaboratorId,
        name: record.name,
        role: record.role,
        cursor: record.cursor,
      });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async publishPresence(scoreId: string): Promise<void> {
    const entries = await this.presenceOf(scoreId);
    await broadcast.publish(scoreId, { type: 'presence', entries });
  }

  /** Expires presence entries the server has not heard from, and drops dead sockets. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    const scores = new Set<string>();
    for (const connection of this.connections.values()) {
      if (now - connection.lastPong > PING_INTERVAL_MS + PONG_GRACE_MS) {
        connection.socket.terminate();
        await this.drop(connection.id);
        continue;
      }
      scores.add(connection.scoreId);
    }
    for (const [scoreId, records] of this.localPresence) {
      const cutoff = now - config.awarenessTtlSeconds * 1000;
      for (const [collaboratorId, record] of records) {
        if (record.at <= cutoff) {
          records.delete(collaboratorId);
          await broadcast.dropPresence(scoreId, collaboratorId);
          scores.add(scoreId);
        }
      }
    }
    for (const scoreId of scores) await this.publishPresence(scoreId);
  }

  private pingAll(): void {
    for (const connection of this.connections.values()) connection.socket.ping();
  }

  private async drop(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    this.connections.delete(connectionId);
    await releaseConnectionHolds(connection.scoreId, connectionId);
    const stillHere = [...this.connections.values()].some(
      (other) =>
        other.scoreId === connection.scoreId &&
        other.collaborator.id === connection.collaborator.id,
    );
    if (!stillHere) {
      this.localPresence.get(connection.scoreId)?.delete(connection.collaborator.id);
      await broadcast.dropPresence(connection.scoreId, connection.collaborator.id);
    }
    await this.publishPresence(connection.scoreId);
  }

  private async closeCollaborator(scoreId: string, collaboratorId: string): Promise<void> {
    for (const connection of [...this.connections.values()]) {
      if (connection.scoreId !== scoreId || connection.collaborator.id !== collaboratorId) continue;
      send(connection.socket, { type: 'removed' });
      connection.socket.close(1000, 'removed');
      await this.drop(connection.id);
    }
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

export const hub = new Hub();
