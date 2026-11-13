import type { RoomEvent, RoomEventData, RoomEventType } from '../../shared/protocol.js';
import { query, type Tx } from '../db/pool.js';
import { publishEvent, replayFromBuffer } from './valkey.js';

export interface EventDraft {
  type: RoomEventType;
  data: RoomEventData;
}

/** Allocates strictly increasing ids inside the caller's room-row lock. */
export async function appendEvents(
  tx: Tx,
  roomId: string,
  drafts: readonly EventDraft[],
): Promise<RoomEvent[]> {
  if (drafts.length === 0) return [];
  const row = await tx.queryOne<{ next_event_id: string }>(
    'UPDATE rooms SET next_event_id = next_event_id + $2 WHERE id = $1 RETURNING next_event_id',
    [roomId, drafts.length],
  );
  if (!row) return [];
  const nextId = Number(row.next_event_id);
  const firstId = nextId - drafts.length;
  const events = drafts.map((draft, offset) => ({
    id: firstId + offset,
    type: draft.type,
    data: draft.data,
  }));
  for (const event of events) {
    await tx.query(
      'INSERT INTO room_events (room_id, id, type, data) VALUES ($1, $2, $3, $4)',
      [roomId, event.id, event.type, JSON.stringify(event.data)],
    );
  }
  return events;
}

const waiters = new Map<string, Set<() => void>>();

export async function publishEvents(roomId: string, events: readonly RoomEvent[]): Promise<void> {
  for (const event of events) {
    await publishEvent(roomId, event);
  }
  if (events.length === 0) return;
  const waiting = waiters.get(roomId);
  if (!waiting) return;
  waiters.delete(roomId);
  for (const wake of waiting) wake();
}

/** Lets the backup link wait for new events without hammering Postgres. */
export function waitForEvents(roomId: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const waiting = waiters.get(roomId) ?? new Set<() => void>();
    waiters.set(roomId, waiting);
    const done = (): void => {
      waiting.delete(wake);
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const wake = done;
    const timer = setTimeout(done, timeoutMs);
    waiting.add(wake);
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function eventsAfter(roomId: string, afterId: number): Promise<RoomEvent[]> {
  const buffered = await replayFromBuffer(roomId, afterId);
  if (buffered) return buffered;
  const rows = await query<{ id: string; type: RoomEventType; data: RoomEventData }>(
    'SELECT id, type, data FROM room_events WHERE room_id = $1 AND id > $2 ORDER BY id',
    [roomId, afterId],
  );
  return rows.map((row) => ({ id: Number(row.id), type: row.type, data: row.data }));
}
