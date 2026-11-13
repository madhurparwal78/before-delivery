import type { OutboxEvent } from './events.js';
import type { Tx } from './db.js';

/** Write one event to the outbox in the caller's transaction. */
export async function enqueueEvent(tx: Tx, event: OutboxEvent): Promise<void> {
  const payload = {
    event_id: event.event_id,
    type: event.type,
    position_id: event.position_id,
    sequence: event.sequence,
    occurred_at: event.occurred_at,
    data: event.data,
  };
  await tx.query(
    `INSERT INTO events (event_id, position_id, type, sequence, occurred_at, payload, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued')`,
    [event.event_id, event.position_id, event.type, event.sequence, event.occurred_at, JSON.stringify(payload)],
  );
}

export interface PendingEvent {
  event_id: string;
  position_id: string | null;
  sequence: string | null;
  payload: unknown;
}

/**
 * Claim queued events that are ready: an event is only ready once its position's
 * earlier sequences have all been delivered.
 */
export async function claimReadyEvents(tx: Tx, limit: number): Promise<PendingEvent[]> {
  const rows = await tx.query<{ event_id: string; position_id: string | null; sequence: string | null; payload: unknown }>(
    `SELECT event_id, position_id, sequence, payload FROM events
     WHERE status = 'queued' AND next_attempt_at <= now()
     ORDER BY created_at
     LIMIT $1`,
    [limit],
  );
  const ready: PendingEvent[] = [];
  const handledPositions = new Set<string>();
  for (const row of rows.rows) {
    const key = row.position_id ?? '';
    if (key !== '' && handledPositions.has(key)) continue;
    if (row.sequence === null) {
      ready.push({ event_id: row.event_id, position_id: row.position_id, sequence: null, payload: row.payload });
      if (key !== '') handledPositions.add(key);
      continue;
    }
    const seq = BigInt(row.sequence);
    if (row.position_id !== null) {
      const delivered = await tx.query<{ delivered_count: string }>(
        `SELECT COUNT(*)::text AS delivered_count FROM events WHERE position_id = $1 AND status = 'delivered'`,
        [row.position_id],
      );
      const deliveredCount = BigInt(delivered.rows[0].delivered_count);
      if (seq !== deliveredCount + 1n) continue;
    }
    ready.push({ event_id: row.event_id, position_id: row.position_id, sequence: row.sequence, payload: row.payload });
    if (key !== '') handledPositions.add(key);
  }
  return ready;
}
