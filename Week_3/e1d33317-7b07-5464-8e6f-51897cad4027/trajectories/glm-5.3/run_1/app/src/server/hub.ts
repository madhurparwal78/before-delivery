import { OpThrottle } from '../domain/throttle.js';
import { ScoreModel, StoredEvent, Operation, ElementId } from '../domain/scoremodel.js';
import { ScoreRepository, RecordedOp } from './repo.js';
import { MINIO } from './services/minio.js';
import { VALKEY } from './services/valkey.js';
import crypto from 'node:crypto';

/** Identifies this server instance so its own Valkey broadcasts are not echoed back. */
export const instanceId = crypto.randomUUID();

export interface HoldEntry {
  staffId: string;
  holderId: string;
  connectionId: string;
  since: number;
}

export interface PresenceEntry {
  collaboratorId: string;
  name: string;
  role: string;
  cursor: { staffId: string; measure: number; beat: number } | null;
  lastHeartbeat: number;
}

export interface LiveConnection {
  id: string;
  scoreId: string;
  collaboratorId: string;
  send(message: Record<string, unknown>): void;
  close(): void;
  ping(): void;
  alive: boolean;
  lastPong: number;
}

export interface BroadcastMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * The runtime centre for one score: its model, live connections, holds and
 * presence. Every instance of the server keeps its own connection registry;
 * Valkey carries the broadcast between instances.
 */
export class ScoreHub {
  model: ScoreModel | null = null;
  readonly scoreId: string;
  holds = new Map<string, HoldEntry>();
  presence = new Map<string, PresenceEntry>();
  connections = new Set<LiveConnection>();
  lastSeq = 0;
  private connectionsById = new Map<string, LiveConnection>();
  private opThrottle = new OpThrottle();
  /** Serialises operation recording so concurrent batches never share a seq. */
  private opChain: Promise<unknown> = Promise.resolve();

  constructor(scoreId: string, private repo: ScoreRepository) {
    this.scoreId = scoreId;
  }

  /** Runs an operation-recording section one at a time, in arrival order. */
  serial<T>(section: () => Promise<T>): Promise<T> {
    const next = this.opChain.then(section, section);
    this.opChain = next.catch(() => undefined);
    return next;
  }

  async load(): Promise<void> {
    const ops = await this.repo.allOperations(this.scoreId);
    this.model = await this.repo.buildModel(this.scoreId, ops);
    this.lastSeq = ops.length > 0 ? ops[ops.length - 1].seq : 0;
    await VALKEY.subscribe(`fairline:score:${this.scoreId}`, (channel, message) => {
      void channel;
      try {
        const parsed = JSON.parse(message) as { type: string; instanceId?: string };
        if (parsed.instanceId === instanceId) return; // our own broadcast came back
        for (const conn of this.connections) conn.send(parsed);
      } catch {
        // malformed broadcasts are ignored
      }
    });
  }

  throttle(): OpThrottle {
    return this.opThrottle;
  }

  register(conn: LiveConnection): void {
    this.connections.add(conn);
    this.connectionsById.set(conn.id, conn);
  }

  unregister(conn: LiveConnection): void {
    this.connections.delete(conn);
    this.connectionsById.delete(conn.id);
    // holds and presence tied to this connection end with it
    for (const [staffId, hold] of this.holds) {
      if (hold.connectionId === conn.id) this.holds.delete(staffId);
    }
    this.presence.delete(conn.collaboratorId);
  }

  connectionById(id: string): LiveConnection | null {
    return this.connectionsById.get(id) ?? null;
  }

  callersOpenConnections(collaboratorId: string): LiveConnection[] {
    return [...this.connections].filter((c) => c.collaboratorId === collaboratorId);
  }

  /** Broadcasts to local sockets and, when live, through Valkey. */
  async broadcast(message: BroadcastMessage): Promise<void> {
    const payload = JSON.stringify({ ...message, instanceId });
    for (const conn of this.connections) {
      conn.send(message);
    }
    if (VALKEY.isConnected) {
      // publishing must never hold the response; a lost broker degrades to local-only
      void VALKEY.publish(`fairline:score:${this.scoreId}`, payload);
    }
  }

  presenceSnapshot(): { collaboratorId: string; name: string; role: string; cursor: PresenceEntry['cursor'] }[] {
    return [...this.presence.values()].map((p) => ({
      collaboratorId: p.collaboratorId,
      name: p.name,
      role: p.role,
      cursor: p.cursor,
    }));
  }

  holdsSnapshot(): { staffId: string; holderId: string; since: string }[] {
    return [...this.holds.values()].map((h) => ({
      staffId: h.staffId,
      holderId: h.holderId,
      since: new Date(h.since).toISOString(),
    }));
  }
}

export { MINIO };
export type { Operation, ElementId, StoredEvent, RecordedOp };
