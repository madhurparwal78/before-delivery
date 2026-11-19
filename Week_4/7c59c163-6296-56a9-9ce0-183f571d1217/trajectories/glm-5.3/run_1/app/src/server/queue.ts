import type { Pool, PoolClient } from './db.js';

export interface QueueMessage {
  kind: 'email' | 'webhook' | 'book' | 'member_event';
  venueId: string | null;
  payload: Record<string, unknown>;
}

export async function enqueue(client: PoolClient, message: QueueMessage): Promise<void> {
  await client.query(
    `INSERT INTO outgoing_queue (id, venue_id, kind, payload) VALUES ($1,$2,$3,$4)`,
    [crypto.randomUUID(), message.venueId, message.kind, JSON.stringify(message.payload)]
  );
}

export async function claimBatch(pool: Pool, workerId: string, kinds: string[], limit: number): Promise<QueueRow[]> {
  const res = await pool.query(
    `UPDATE outgoing_queue SET claimed_by = $1, claimed_until = now() + interval '30 seconds', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM outgoing_queue WHERE kind = ANY($2) AND next_attempt_at <= now() AND claimed_until IS NULL
       ORDER BY created_at LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, kind, venue_id, payload, attempts`,
    [workerId, kinds, limit]
  );
  return res.rows as QueueRow[];
}

export async function complete(id: string, pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM outgoing_queue WHERE id = $1`, [id]);
}

export async function fail(id: string, pool: Pool, backoffMs: number): Promise<void> {
  await pool.query(
    `UPDATE outgoing_queue SET claimed_until = NULL, next_attempt_at = now() + ($2 || ' milliseconds')::interval WHERE id = $1`,
    [id, String(backoffMs)]
  );
}

export interface QueueRow {
  id: string;
  kind: string;
  venue_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}
