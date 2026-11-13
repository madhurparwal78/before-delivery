/** Idempotency keys on submits: a repeat replays, a clash is refused. */

import type { Db } from './db.js';
import { conflict } from './errors.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export function keyIsWellFormed(key: string): boolean {
  if (key.length < 1 || key.length > 64) return false;
  return /^[\x21-\x7e]+$/.test(key);
}

/** A stable rendering of a parsed body: key order and white space ignored, array order kept. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([name, held]) => [name, canonicalJson(held)] as const)
      .sort((left, right) => (left[0] < right[0] ? -1 : 1));
    return `{${entries.map(([name, held]) => `${JSON.stringify(name)}:${held}`).join(',')}}`;
  }
  return 'null';
}

export interface StoredSubmit {
  status: number;
  body: string;
}

export async function replayOrClash(
  db: Db,
  teamId: number,
  key: string,
  round: number,
  body: string,
): Promise<StoredSubmit | null> {
  const result = await db.query<{ round: number; body: string; status: number; response: string }>(
    'select round, body, status, response from idempotency where team_id = $1 and key = $2',
    [teamId, key],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  if (row.round !== round || row.body !== body) throw conflict('idempotency_conflict');
  return { status: row.status, body: row.response };
}

export async function rememberSubmit(
  db: Db,
  teamId: number,
  key: string,
  round: number,
  body: string,
  status: number,
  response: string,
): Promise<void> {
  await db.query(
    `insert into idempotency (team_id, key, round, body, status, response)
     values ($1, $2, $3, $4, $5, $6) on conflict (team_id, key) do nothing`,
    [teamId, key, round, body, status, response],
  );
}
