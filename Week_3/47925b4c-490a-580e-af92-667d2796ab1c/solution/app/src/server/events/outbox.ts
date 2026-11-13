import { randomUUID } from 'node:crypto';
import { type Queryable, type Row, query, transact } from '../db/pool.js';

export type EventType =
  | 'reading.accepted'
  | 'kit.moved'
  | 'hold.changed'
  | 'layout.changed'
  | 'sheet.changed'
  | 'circuit.confirmed'
  | 'mask_job.changed';

const AGGREGATES: Record<EventType, string> = {
  'reading.accepted': 'site',
  'kit.moved': 'kit',
  'hold.changed': 'hold',
  'layout.changed': 'layout',
  'sheet.changed': 'sheet',
  'circuit.confirmed': 'sheet',
  'mask_job.changed': 'mask_job',
};

export interface EventFrame {
  readonly type: EventType;
  readonly aggregate: string;
  readonly aggregateId: string;
  readonly sequence: number;
  readonly at: string;
  readonly data: Record<string, unknown>;
}

/** Writes an event in the caller's transaction; the dispatcher gives it its sequence. */
export async function writeEvent(
  client: Queryable,
  type: EventType,
  aggregateId: string,
  data: Record<string, unknown>,
  sheetId: string | null = null,
): Promise<void> {
  await client.query(
    `insert into events (id, type, aggregate, aggregate_id, data, sheet_id)
     values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [randomUUID(), type, AGGREGATES[type], aggregateId, JSON.stringify(data), sheetId],
  );
}

/**
 * Hands dense, strictly increasing sequence numbers to committed events. The
 * advisory lock makes one process do this at a time, so a sequence is only ever
 * given to an event that is already visible.
 */
export async function dispatchEvents(): Promise<number> {
  return transact(async (client) => {
    await client.query('select pg_advisory_xact_lock(8431001)');
    const pending = await client.query('select id from events where sequence is null order by ordinal limit 500');
    if (pending.rows.length === 0) return 0;
    const counter = await client.query('update event_counter set value = value + $1 where id = 1 returning value', [
      pending.rows.length,
    ]);
    const start = Number(counter.rows[0]?.['value']) - pending.rows.length;
    for (const [index, row] of pending.rows.entries()) {
      await client.query('update events set sequence = $1 where id = $2', [String(start + index + 1), row['id']]);
    }
    return pending.rows.length;
  });
}

export async function readEvents(afterSequence: number, limit: number): Promise<EventFrame[]> {
  const rows = await query<Row>(
    `select sequence, type, aggregate, aggregate_id, at, data
     from events
     where sequence is not null and sequence > $1
     order by sequence
     limit $2`,
    [String(afterSequence), limit],
  );
  return rows.map(toFrame);
}

export async function readSheetEvents(sheetId: string, afterSequence: number, limit: number): Promise<EventFrame[]> {
  const rows = await query<Row>(
    `select sequence, type, aggregate, aggregate_id, at, data
     from events
     where sequence is not null and sequence > $1 and sheet_id = $2
       and type in ('sheet.changed', 'circuit.confirmed')
     order by sequence
     limit $3`,
    [String(afterSequence), sheetId, limit],
  );
  return rows.map(toFrame);
}

export async function latestSequence(): Promise<number> {
  const rows = await query<{ value: string }>('select value from event_counter where id = 1');
  return Number(rows[0]?.value ?? '0');
}

function toFrame(row: Row): EventFrame {
  return {
    type: row['type'] as EventType,
    aggregate: row['aggregate'] as string,
    aggregateId: row['aggregate_id'] as string,
    sequence: Number(row['sequence']),
    at: (row['at'] as Date).toISOString(),
    data: row['data'] as Record<string, unknown>,
  };
}
