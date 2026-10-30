import { PoolClient } from 'pg';
import { pool } from '../db';
import { Evaluation, evaluateWorkbook } from '../../shared/formula/evaluate';
import { StoredOp, applyOp } from '../../shared/ops';
import { WorkbookState, emptyWorkbookState } from '../../shared/workbook';

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export function queryable(client?: PoolClient): Queryable {
  return (client ?? pool) as unknown as Queryable;
}

interface OpRow {
  seq: number;
  author_id: string;
  type: string;
  payload: Record<string, unknown>;
}

/** Workbook state is derived only by replaying the stored op sequence. */
export async function loadWorkbookState(
  workbookId: string,
  client?: PoolClient,
  maxSeq?: number,
): Promise<{ state: WorkbookState; headSeq: number }> {
  const result = await queryable(client).query(
    `select seq, author_id, type, payload from ops
     where workbook_id = $1 and ($2::int is null or seq <= $2) order by seq asc`,
    [workbookId, maxSeq ?? null],
  );
  const state = emptyWorkbookState();
  let headSeq = 0;
  for (const raw of result.rows as unknown as OpRow[]) {
    const op = { type: raw.type, ...raw.payload } as unknown as StoredOp;
    applyOp(state, op, raw.seq, raw.author_id);
    headSeq = raw.seq;
  }
  return { state, headSeq };
}

export function evaluate(state: WorkbookState, timeZone: string): Evaluation {
  return evaluateWorkbook(state, { timeZone, nowMs: Date.now() });
}

export async function insertOp(
  client: PoolClient,
  workbookId: string,
  seq: number,
  authorId: string,
  op: StoredOp,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(op)) {
    if (key === 'type' || key === 'opId') continue;
    payload[key] = value;
  }
  await client.query('insert into ops (workbook_id, seq, author_id, type, payload) values ($1,$2,$3,$4,$5)', [
    workbookId,
    seq,
    authorId,
    op.type,
    JSON.stringify(payload),
  ]);
}

export async function insertOps(
  client: PoolClient,
  workbookId: string,
  startSeq: number,
  authorId: string,
  ops: StoredOp[],
): Promise<number> {
  let seq = startSeq;
  const chunkSize = 500;
  for (let start = 0; start < ops.length; start += chunkSize) {
    const chunk = ops.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const rows: string[] = [];
    chunk.forEach((op, index) => {
      seq += 1;
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(op)) {
        if (key === 'type' || key === 'opId') continue;
        payload[key] = value;
      }
      const base = index * 5;
      rows.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
      values.push(workbookId, seq, authorId, op.type, JSON.stringify(payload));
    });
    await client.query(
      `insert into ops (workbook_id, seq, author_id, type, payload) values ${rows.join(',')}`,
      values,
    );
  }
  return seq;
}

export async function touchWorkbook(client: PoolClient, workbookId: string, headSeq: number): Promise<void> {
  await client.query('update workbooks set head_seq = $2, updated_at = now() where id = $1', [workbookId, headSeq]);
}
