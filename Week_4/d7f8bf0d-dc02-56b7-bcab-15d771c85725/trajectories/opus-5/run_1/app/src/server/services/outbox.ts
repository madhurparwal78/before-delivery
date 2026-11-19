import type pg from 'pg';
import { pool } from '../db/pool.js';
import { appendEvent, ensureProbed } from './valkey.js';

export async function writeOutbox(
  client: pg.PoolClient,
  stream: string,
  seq: number,
  type: string,
  payload: unknown,
): Promise<void> {
  await client.query(
    `insert into event_outbox (stream, seq, type, payload) values ($1, $2, $3, $4)
     on conflict (stream, seq) do nothing`,
    [stream, seq, type, JSON.stringify(payload)],
  );
}

/** Sends every outbox row that has not reached its stream yet, in commit order. */
export async function publishPending(): Promise<void> {
  if (!(await ensureProbed(2000))) return;
  const { rows } = await pool.query<{ stream: string; seq: string; type: string; payload: unknown }>(
    `select stream, seq, type, payload from event_outbox
     where published_at is null order by stream, seq limit 500`,
  );
  for (const row of rows) {
    const seq = Number(row.seq);
    await appendEvent(row.stream, seq, row.type, JSON.stringify(row.payload));
    await pool.query(
      `update event_outbox set published_at = now() where stream = $1 and seq = $2`,
      [row.stream, seq],
    );
  }
}
