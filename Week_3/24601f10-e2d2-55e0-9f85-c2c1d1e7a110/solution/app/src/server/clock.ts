import { pool, tx, type Client } from './db.js';

// Server time is real time plus the grading offset. The offset lives in Postgres so every instance agrees on it.
let offsetMs = 0;
let readAt = 0;
const TTL_MS = 250;

export async function serverNow(): Promise<number> {
  const real = Date.now();
  if (real - readAt > TTL_MS) {
    const { rows } = await pool.query<{ offset_ms: number }>('SELECT offset_ms FROM server_clock WHERE id = 1');
    offsetMs = rows[0]?.offset_ms ?? 0;
    readAt = real;
  }
  return real + offsetMs;
}

export async function moveClock(advanceMs: number): Promise<number> {
  return tx(async (client: Client) => {
    const { rows } = await client.query<{ offset_ms: number }>(
      'UPDATE server_clock SET offset_ms = offset_ms + $1 WHERE id = 1 RETURNING offset_ms', [advanceMs]);
    offsetMs = rows[0]?.offset_ms ?? offsetMs;
    readAt = Date.now();
    return Date.now() + offsetMs;
  });
}

export const iso = (ms: number): string => new Date(ms).toISOString();
