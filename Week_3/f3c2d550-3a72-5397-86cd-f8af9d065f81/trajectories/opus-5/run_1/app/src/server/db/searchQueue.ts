import type { Queryable } from './pool.js';
import { pool } from './pool.js';

export type SearchOp = 'upsert' | 'delete';

export interface SearchUpdateRow {
  seq: number;
  reference_id: string;
  op: SearchOp;
}

/** Records one index update, in order, so that it is applied exactly once. */
export async function recordSearchUpdate(
  client: Queryable,
  referenceId: string,
  op: SearchOp,
  nowIsoValue: string,
): Promise<number> {
  const result = await client.query<{ seq: string }>(
    `insert into search_update (reference_id, op, recorded_at)
     values ($1, $2, $3::timestamptz) returning seq::text`,
    [referenceId, op, nowIsoValue],
  );
  return Number(result.rows[0]!.seq);
}

export async function pendingUpdates(limit: number): Promise<SearchUpdateRow[]> {
  const result = await pool.query<{ seq: string; reference_id: string; op: SearchOp }>(
    `select seq::text, reference_id, op from search_update
     where applied_at is null order by seq limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    seq: Number(row.seq),
    reference_id: row.reference_id,
    op: row.op,
  }));
}

export async function markApplied(seq: number, nowIsoValue: string): Promise<void> {
  await pool.query(
    `update search_update set applied_at = $2::timestamptz where seq = $1 and applied_at is null`,
    [seq, nowIsoValue],
  );
}

export async function isApplied(seq: number): Promise<boolean> {
  const result = await pool.query<{ applied: boolean }>(
    'select applied_at is not null as applied from search_update where seq = $1',
    [seq],
  );
  return result.rows[0]?.applied ?? false;
}
