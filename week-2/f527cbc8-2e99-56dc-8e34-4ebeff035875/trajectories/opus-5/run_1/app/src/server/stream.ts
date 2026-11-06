import { query, queryOne, type Db } from './db.js';

/**
 * Live streams. Each barn day has one stream per role and each horse one for staff and
 * one for its owner. Within a stream `id:` is a contiguous integer from 1, allocated
 * under that day's or horse's serialisation, so commit order can never skip a number.
 */
export type StreamRole = 'farrier' | 'apprentice' | 'barn_manager';
export type HorseAudience = 'staff' | 'owner';

export type BarnDayEvent =
  | 'booking_added'
  | 'booking_removed'
  | 'booking_moved'
  | 'day_status'
  | 'allocation_fixed'
  | 'allocation_adjusted';

export type HorseEvent = 'marks_saved' | 'visit_closed';

export function barnDayChannel(barnDayId: string, role: StreamRole): string {
  return `barn_day:${barnDayId}:${role}`;
}

export function horseChannel(horseId: string, audience: HorseAudience): string {
  return `horse:${horseId}:${audience}`;
}

/**
 * Appends one event to a channel. The caller already holds the day's or horse's row
 * lock, so the per-channel counter cannot interleave.
 */
export async function appendEvent(
  db: Db,
  channel: string,
  event: string,
  data: unknown,
  at: Date,
): Promise<number> {
  const row = await queryOne<{ seq: string | number }>(
    db,
    `INSERT INTO stream_events (channel, seq, event, data, at)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3::jsonb, $4
     FROM stream_events WHERE channel = $1
     RETURNING seq`,
    [channel, event, JSON.stringify(data), at],
  );
  if (row === null) throw new Error('event was not appended');
  return Number(row.seq);
}

export interface StoredEvent {
  seq: number;
  event: string;
  data: unknown;
}

export async function readEventsAfter(
  db: Db,
  channel: string,
  afterSeq: number,
  retention: number,
): Promise<{ kind: 'events'; events: StoredEvent[] } | { kind: 'reset' }> {
  const newest = await queryOne<{ max: number | null; oldest_kept: number | null }>(
    db,
    `SELECT MAX(seq)::int AS max,
            (SELECT MIN(seq)::int FROM (
               SELECT seq FROM stream_events WHERE channel = $1 ORDER BY seq DESC LIMIT $2
             ) AS kept) AS oldest_kept
     FROM stream_events WHERE channel = $1`,
    [channel, retention],
  );
  const max = newest?.max ?? 0;
  const oldestKept = newest?.oldest_kept ?? 1;
  if (afterSeq > max) return { kind: 'reset' };
  if (afterSeq + 1 < oldestKept) return { kind: 'reset' };
  const rows = await query<{ seq: number; event: string; data: unknown }>(
    db,
    `SELECT seq::int AS seq, event, data FROM stream_events
     WHERE channel = $1 AND seq > $2 ORDER BY seq ASC`,
    [channel, afterSeq],
  );
  return { kind: 'events', events: rows.map((row) => ({ seq: row.seq, event: row.event, data: row.data })) };
}

export async function newestSeq(db: Db, channel: string): Promise<number> {
  const row = await queryOne<{ max: number | null }>(
    db,
    'SELECT MAX(seq)::int AS max FROM stream_events WHERE channel = $1',
    [channel],
  );
  return row?.max ?? 0;
}
