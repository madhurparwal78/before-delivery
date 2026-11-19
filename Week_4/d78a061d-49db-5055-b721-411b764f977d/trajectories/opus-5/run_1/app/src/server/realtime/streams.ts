import { randomUUID } from 'node:crypto';
import { pool, query } from '../db.js';
import type { ServerEvent, StreamEventPayload } from '../../shared/types.js';
import { publish } from './bus.js';

/** Allocates the next seq for a stream. Counters live in Postgres and never restart. */
export async function nextSeq(stream: string): Promise<number> {
  const rows = await query<{ last_seq: string }>(
    `INSERT INTO event_streams (stream, last_seq) VALUES ($1, 1)
     ON CONFLICT (stream) DO UPDATE SET last_seq = event_streams.last_seq + 1
     RETURNING last_seq`,
    [stream],
  );
  return Number(rows[0].last_seq);
}

export async function appendEvent(
  stream: string,
  payload: StreamEventPayload,
): Promise<ServerEvent> {
  const seq = await nextSeq(stream);
  const eventId = randomUUID();
  await pool.query(
    'INSERT INTO events (stream, seq, event_id, payload) VALUES ($1, $2, $3, $4)',
    [stream, seq, eventId, JSON.stringify(payload)],
  );
  const event: ServerEvent = { type: 'event', stream, seq, event_id: eventId, event: payload };
  await publish({ kind: 'event', stream, seq });
  return event;
}

export async function readEventsSince(stream: string, afterSeq: number): Promise<ServerEvent[]> {
  const rows = await query<{ seq: string; event_id: string; payload: StreamEventPayload }>(
    'SELECT seq, event_id, payload FROM events WHERE stream = $1 AND seq > $2 ORDER BY seq',
    [stream, afterSeq],
  );
  return rows.map((row) => ({
    type: 'event',
    stream,
    seq: Number(row.seq),
    event_id: row.event_id,
    event: row.payload,
  }));
}

export async function readEvent(stream: string, seq: number): Promise<ServerEvent | null> {
  const rows = await query<{ event_id: string; payload: StreamEventPayload }>(
    'SELECT event_id, payload FROM events WHERE stream = $1 AND seq = $2',
    [stream, seq],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { type: 'event', stream, seq, event_id: row.event_id, event: row.payload };
}
