import { createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';

export interface StoredOperationResult {
  readonly status: number;
  readonly body: unknown;
}

export interface OperationOwnership {
  /** This request owns the operation and must run the handler, then record the outcome. */
  readonly kind: 'owner';
}

export type OperationLookup = OperationOwnership | { readonly kind: 'replay'; readonly result: StoredOperationResult };

function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

const WAIT_STEP_MS = 25;
const WAIT_LIMIT_MS = 15_000;

interface OperationRow {
  method: string;
  path: string;
  body_hash: string;
  status: number | null;
  response_body: string | null;
}

async function readOperation(actorKey: string, clientOpId: string): Promise<OperationRow | null> {
  const result = await pool.query<OperationRow>(
    `SELECT method, path, body_hash, status, response_body
       FROM operations WHERE actor_key = $1 AND client_op_id = $2`,
    [actorKey, clientOpId],
  );
  return result.rows[0] ?? null;
}

/**
 * Claims an operation id for this request, or resolves it as a replay.
 *
 * A repeat with the same actor, id, method, path and body returns the stored response byte
 * for byte. Copies that arrive while the first copy is still running wait for it. A different
 * body under the same id answers `op_conflict`.
 */
export async function claimOperation(
  actorKey: string,
  clientOpId: string,
  method: string,
  path: string,
  body: unknown,
): Promise<OperationLookup> {
  const hash = bodyHash(body);
  const claimed = await pool.query(
    `INSERT INTO operations (actor_key, client_op_id, method, path, body_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (actor_key, client_op_id) DO NOTHING`,
    [actorKey, clientOpId, method, path, hash],
  );
  if (claimed.rowCount === 1) return { kind: 'owner' };

  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const row = await readOperation(actorKey, clientOpId);
    if (!row) {
      // The first copy failed with a 5xx and released the id, so this copy may run it.
      const retry = await pool.query(
        `INSERT INTO operations (actor_key, client_op_id, method, path, body_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (actor_key, client_op_id) DO NOTHING`,
        [actorKey, clientOpId, method, path, hash],
      );
      if (retry.rowCount === 1) return { kind: 'owner' };
      continue;
    }
    if (row.method !== method || row.path !== path || row.body_hash !== hash) {
      if (row.status === null && Date.now() < deadline) {
        // A concurrent copy of a different body: exactly one body is applied, so wait to
        // learn whether this body is the one that won.
        await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
        continue;
      }
      throw new AppError('op_conflict');
    }
    if (row.status !== null && row.response_body !== null) {
      return { kind: 'replay', result: { status: row.status, body: JSON.parse(row.response_body) } };
    }
    if (Date.now() >= deadline) throw new AppError('op_conflict');
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

/** Every 2xx and 4xx response is stored. */
export async function recordOperationResult(
  actorKey: string,
  clientOpId: string,
  result: StoredOperationResult,
): Promise<void> {
  await pool.query(
    `UPDATE operations SET status = $3, response_body = $4, completed_at = now()
      WHERE actor_key = $1 AND client_op_id = $2`,
    [actorKey, clientOpId, result.status, JSON.stringify(result.body)],
  );
}

/** A 5xx response is not stored, so a later retry with the same id runs again. */
export async function releaseOperation(actorKey: string, clientOpId: string): Promise<void> {
  await pool.query(
    `DELETE FROM operations WHERE actor_key = $1 AND client_op_id = $2 AND status IS NULL`,
    [actorKey, clientOpId],
  );
}
