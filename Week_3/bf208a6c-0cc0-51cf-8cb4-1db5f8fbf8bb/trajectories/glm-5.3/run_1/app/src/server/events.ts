import type { Db } from './db.js';
import type { ServerResponse } from 'node:http';

type AccessCheck = () => Promise<{ open: boolean; reason: 'not_found' | 'password_required' | null } | null>;

interface Listener {
  boardId: string;
  check: AccessCheck;
  res: ServerResponse;
  lastSentId: number;
  keepAlive: NodeJS.Timeout;
}

export class EventHub {
  private listeners = new Set<Listener>();

  constructor(private db: Db) {}

  async publish(boardId: string, payload: Record<string, unknown>): Promise<void> {
    const inserted = await this.db.query(
      'INSERT INTO board_events (board_id, payload) VALUES ($1, $2) RETURNING id',
      [boardId, JSON.stringify({ board_id: boardId, ...payload })],
    );
    const row = inserted.rows[0] as { id: string };
    const id = Number(row.id);
    const data = { board_id: boardId, ...payload };
    for (const listener of this.listeners) {
      if (listener.boardId === boardId) {
        this.writeEvent(listener.res, id, data);
        listener.lastSentId = id;
      }
    }
  }

  async replaySince(boardId: string, lastEventId: number): Promise<{ id: number; payload: Record<string, unknown> }[]> {
    const res = await this.db.query(
      'SELECT id, payload FROM board_events WHERE board_id = $1 AND id > $2 ORDER BY id',
      [boardId, lastEventId],
    );
    return res.rows.map((r) => {
      const row = r as { id: string; payload: Record<string, unknown> };
      return { id: Number(row.id), payload: row.payload };
    });
  }

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: Listener): void {
    clearTimeout(listener.keepAlive);
    this.listeners.delete(listener);
  }

  writeEvent(res: ServerResponse, id: number, payload: Record<string, unknown>): void {
    res.write(`id: ${id}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  async closeBoard(boardId: string, reason: 'not_found' | 'password_required'): Promise<void> {
    for (const listener of [...this.listeners]) {
      if (listener.boardId === boardId) {
        this.writeEvent(listener.res, listener.lastSentId + 1, { type: 'access_lost', reason });
        listener.res.end();
        this.unsubscribe(listener);
      }
    }
  }
}
