import type { Pool } from 'pg';
import type { Config } from './config.js';
import type { UndoStepKind } from '../domain/types.js';
import { newId } from './store.js';

export interface RecordedStep {
  id: string;
  kind: UndoStepKind;
  data: Record<string, unknown>;
}

export async function recordStep(
  pool: Pool,
  config: Config,
  accountId: string,
  kind: UndoStepKind,
  data: Record<string, unknown>,
): Promise<RecordedStep> {
  const id = newId();
  const createdAt = Date.now();
  await pool.query(
    `insert into undo_steps (id, account_id, kind, created_at, payload) values ($1,$2,$3,$4,$5)`,
    [id, accountId, kind, createdAt, JSON.stringify(data)],
  );
  await pool.query(
    `delete from undo_steps where account_id = $1 and id not in (
       select id from undo_steps where account_id = $1 order by created_at desc, id desc limit $2
     )`,
    [accountId, config.undoDepth],
  );
  await pool.query(`delete from redo_steps where account_id = $1`, [accountId]);
  return { id, kind, data };
}

export async function clearRedo(pool: Pool, accountId: string): Promise<void> {
  await pool.query(`delete from redo_steps where account_id = $1`, [accountId]);
}

export async function latestStep(pool: Pool, accountId: string): Promise<RecordedStep | null> {
  const rows = await pool.query(
    `select * from undo_steps where account_id = $1 order by created_at desc, id desc limit 1`,
    [accountId],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return { id: String(row.id), kind: row.kind as UndoStepKind, data: row.payload as Record<string, unknown> };
}

export async function removeStep(pool: Pool, stepId: string): Promise<void> {
  await pool.query(`delete from undo_steps where id = $1`, [stepId]);
}

export async function pushRedo(
  pool: Pool,
  config: Config,
  accountId: string,
  step: RecordedStep,
): Promise<void> {
  await pool.query(
    `insert into redo_steps (id, account_id, kind, created_at, payload)
     values ($1,$2,$3,$4,$5)`,
    [newId(), accountId, step.kind, Date.now(), JSON.stringify(step.data)],
  );
  await pool.query(
    `delete from redo_steps where account_id = $1 and id not in (
       select id from redo_steps where account_id = $1 order by created_at desc, id desc limit $2
     )`,
    [accountId, config.undoDepth],
  );
}

export async function popRedo(pool: Pool, accountId: string): Promise<RecordedStep | null> {
  const rows = await pool.query(
    `select * from redo_steps where account_id = $1 order by created_at desc, id desc limit 1`,
    [accountId],
  );
  const row = rows.rows[0];
  if (!row) return null;
  await pool.query(`delete from redo_steps where id = $1`, [row.id]);
  return { id: String(row.id), kind: row.kind as UndoStepKind, data: row.payload as Record<string, unknown> };
}

export async function peekRedo(pool: Pool, accountId: string): Promise<RecordedStep | null> {
  const rows = await pool.query(
    `select * from redo_steps where account_id = $1 order by created_at desc, id desc limit 1`,
    [accountId],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return { id: String(row.id), kind: row.kind as UndoStepKind, data: row.payload as Record<string, unknown> };
}
