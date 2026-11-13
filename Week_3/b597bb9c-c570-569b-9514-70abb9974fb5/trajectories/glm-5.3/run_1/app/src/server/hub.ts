import type { WebSocket } from 'ws';
import type { Db } from './db';
import type { LiveHub, SocketEntry } from './ctx';

interface HubSocket extends Required<SocketEntry> {
  version: number;
  closed: boolean;
}

/**
 * The live socket hub. Each project page and review page holds exactly one
 * WebSocket. Role changes and removals close sockets at once with 4403;
 * sign-out closes them with 4401; review link changes close with 4410.
 */
export class Hub implements LiveHub {
  private sockets = new Set<HubSocket>();
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  register(entry: SocketEntry): SocketEntry {
    const socket = entry as HubSocket;
    socket.version = 0;
    socket.closed = false;
    this.sockets.add(socket);
    return socket;
  }

  unregister(entry: SocketEntry): void {
    this.sockets.delete(entry as HubSocket);
  }

  setVersion(entry: SocketEntry, version: number): void {
    (entry as HubSocket).version = version;
  }

  /** Replay missed changes after a reconnect: none applied twice. */
  replay(entry: SocketEntry, messages: Record<string, unknown>[]): void {
    const socket = entry as HubSocket;
    for (const message of messages) {
      if (socket.closed) return;
      entry.ws.send(JSON.stringify(message));
    }
  }

  publishOp(projectId: string, message: Record<string, unknown>): void {
    for (const entry of this.sockets) {
      if (entry.closed || entry.projectId !== projectId) continue;
      entry.ws.send(JSON.stringify(message));
    }
  }

  publishComment(projectId: string, message: Record<string, unknown>): void {
    for (const entry of this.sockets) {
      if (entry.closed) continue;
      if (entry.projectId !== projectId) continue;
      // Review pages receive only review-visibility comments.
      if (entry.reviewLinkId !== null) {
        const comment = (message as { comment?: { visibility?: string } }).comment;
        if (comment?.visibility !== 'review') continue;
      }
      entry.ws.send(JSON.stringify(message));
    }
  }

  publishExport(projectId: string, message: Record<string, unknown>): void {
    this.publishOp(projectId, message);
  }

  publishAllowance(message: Record<string, unknown>): void {
    for (const entry of this.sockets) {
      if (entry.closed) continue;
      entry.ws.send(JSON.stringify(message));
    }
  }

  publishCutShared(projectId: string, message: Record<string, unknown>): void {
    for (const entry of this.sockets) {
      if (entry.closed || entry.reviewLinkId === null) continue;
      if (entry.projectId !== projectId) continue;
      entry.ws.send(JSON.stringify(message));
    }
  }

  roleChanged(projectId: string, personId: string, role: string | null): void {
    for (const entry of this.sockets) {
      if (entry.closed || entry.personId !== personId || entry.projectId !== projectId) continue;
      entry.ws.send(JSON.stringify({ type: 'role_changed', role }));
      entry.ws.close(4403);
      entry.closed = true;
      this.sockets.delete(entry);
    }
  }

  closeReview(reviewLinkId: string): void {
    for (const entry of this.sockets) {
      if (entry.closed || entry.reviewLinkId !== reviewLinkId) continue;
      entry.ws.close(4410);
      entry.closed = true;
      this.sockets.delete(entry);
    }
  }

  closeSessionsOf(personId: string): void {
    for (const entry of this.sockets) {
      if (entry.closed || entry.personId !== personId) continue;
      entry.ws.close(4401);
      entry.closed = true;
      this.sockets.delete(entry);
    }
  }

  /** Expiry sweep: links that pass their time close their review sockets. */
  async sweepReviewExpiry(): Promise<void> {
    const expired = await this.db.query<{ id: string }>(
      `SELECT id FROM review_links WHERE state = 'active' AND expires_at < now()`,
    );
    for (const row of expired.rows) {
      await this.db.query("UPDATE review_links SET state = 'expired' WHERE id = $1", [row.id]);
      this.closeReview(row.id);
    }
  }
}
