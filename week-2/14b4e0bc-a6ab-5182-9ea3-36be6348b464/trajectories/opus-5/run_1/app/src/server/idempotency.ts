import { createHash } from 'node:crypto';
import { query } from './db.ts';
import { errors } from './http/errors.ts';

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export interface IdempotencyScope {
  actorId: string;
  route: string;
  assetId: string;
  key: string | null;
  fingerprint: string;
}

export interface StoredReply {
  status: number;
  body: unknown;
}

export interface IdempotencyHandle {
  /** Stores a successful response under the key. */
  succeed(status: number, body: unknown): Promise<void>;
  /** A failed request frees its key, so a retry under the same key runs again. */
  release(): Promise<void>;
}

export function fingerprintOf(parts: readonly (string | Buffer)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(typeof part === 'string' ? Buffer.from(part, 'utf8') : part);
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

export function requireValidKey(key: string | null): void {
  if (key !== null && !KEY_PATTERN.test(key)) {
    throw errors.validation({
      idempotency_key: 'Use 1 to 100 letters, digits, hyphens or underscores.',
    });
  }
}

const NO_KEY_HANDLE: IdempotencyHandle = {
  succeed: async () => undefined,
  release: async () => undefined,
};

/**
 * Claims the key before any later check. Returns a stored reply to replay, a conflict the
 * route raises after its existence and role checks, or a handle that records this attempt.
 */
export async function claimIdempotency(
  scope: IdempotencyScope,
): Promise<{ replay: StoredReply } | { conflict: true } | { handle: IdempotencyHandle }> {
  if (scope.key === null) return { handle: NO_KEY_HANDLE };
  const inserted = await query(
    `INSERT INTO idempotency_records (actor_id, route, asset_id, key, fingerprint, state)
     VALUES ($1,$2,$3,$4,$5,'in_progress')
     ON CONFLICT (actor_id, route, asset_id, key) DO NOTHING`,
    [scope.actorId, scope.route, scope.assetId, scope.key, scope.fingerprint],
  );
  if (inserted.rowCount === 0) {
    const existing = await query<{ fingerprint: string; state: string; status: number; response: unknown }>(
      `SELECT fingerprint, state, status, response FROM idempotency_records
        WHERE actor_id = $1 AND route = $2 AND asset_id = $3 AND key = $4`,
      [scope.actorId, scope.route, scope.assetId, scope.key],
    );
    const row = existing.rows[0];
    if (row && row.state === 'in_progress') throw errors.idempotencyInProgress();
    if (row && row.fingerprint === scope.fingerprint) {
      return { replay: { status: row.status, body: row.response } };
    }
    return { conflict: true };
  }
  const key = scope.key;
  return {
    handle: {
      succeed: async (status, body) => {
        await query(
          `UPDATE idempotency_records SET state = 'done', status = $5, response = $6
            WHERE actor_id = $1 AND route = $2 AND asset_id = $3 AND key = $4`,
          [scope.actorId, scope.route, scope.assetId, key, status, JSON.stringify(body)],
        );
      },
      release: async () => {
        await query(
          `DELETE FROM idempotency_records
            WHERE actor_id = $1 AND route = $2 AND asset_id = $3 AND key = $4 AND state = 'in_progress'`,
          [scope.actorId, scope.route, scope.assetId, key],
        );
      },
    },
  };
}
