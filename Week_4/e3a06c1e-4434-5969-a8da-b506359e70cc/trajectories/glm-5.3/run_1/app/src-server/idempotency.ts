// Idempotency records: stored only for requests that began executing and ended 2xx, 409 or 429.

import { createHash } from 'node:crypto';
import type { Db } from './db';

export type StoredResponse = { status: number; body: Buffer; contentType: string };

const STORED_STATUSES = new Set([201, 200, 202, 204, 409, 429]);

export function fingerprint(parts: (string | Buffer)[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    if (typeof p === 'string') h.update(Buffer.from(p, 'utf8'));
    else h.update(p);
  }
  return h.digest('hex');
}

export async function beginIdempotent(
  db: Db,
  memberId: string,
  key: string,
  method: string,
  path: string,
  fingerprintValue: string,
): Promise<StoredResponse | 'new' | 'in_progress'> {
  // Atomically claim the key with an INSERT that respects an in-progress marker.
  const { rows } = await db.query(
    `INSERT INTO idempotency_records (member_id, key_value, method, path, request_fingerprint, status, body, content_type)
     VALUES ($1, $2, $3, $4, $5, -1, $6, 'application/json')
     ON CONFLICT (member_id, key_value) DO NOTHING
     RETURNING member_id`,
    [memberId, key, method, path, fingerprintValue, Buffer.alloc(0)],
  );
  if (rows.length > 0) return 'new';

  const existing = await db.query< { status: number; body: Buffer; content_type: string; request_fingerprint: string }>(
    `SELECT status, body, content_type, request_fingerprint FROM idempotency_records WHERE member_id=$1 AND key_value=$2`,
    [memberId, key],
  );
  const row = existing.rows[0];
  if (row.status === -1) {
    if (row.request_fingerprint !== fingerprintValue) {
      // The in-flight record belongs to a different request: conflict.
      return { status: 409, body: Buffer.from(JSON.stringify({ error: 'idempotency_conflict', message: 'This idempotency key is already in use.' })), contentType: 'application/json' };
    }
    return 'in_progress';
  }
  if (row.request_fingerprint !== fingerprintValue) {
    return { status: 409, body: Buffer.from(JSON.stringify({ error: 'idempotency_conflict', message: 'This idempotency key was used for a different request.' })), contentType: 'application/json' };
  }
  return { status: row.status, body: row.body, contentType: row.content_type };
}

export async function finishIdempotent(db: Db, memberId: string, key: string, status: number, body: Buffer, contentType: string): Promise<void> {
  if (STORED_STATUSES.has(status)) {
    await db.query(
      `UPDATE idempotency_records SET status=$3, body=$4, content_type=$5 WHERE member_id=$1 AND key_value=$2`,
      [memberId, key, status, body, contentType],
    );
  } else {
    // 422 and 503 store nothing: the key is released for a fresh evaluation.
    await db.query(`DELETE FROM idempotency_records WHERE member_id=$1 AND key_value=$2`, [memberId, key]);
  }
}
