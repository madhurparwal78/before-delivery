import type { Database, Queryable } from './pool.js';
import { isUniqueViolation } from './pool.js';
import { conflict } from '../http/errors.js';
import type { ApiVersion } from '../api/versions.js';

export type KeyClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'replay'; readonly status: number; readonly body: string };

const VISIBLE_ASCII = /^[\x21-\x7e]{1,255}$/;

export function isWellFormedKey(key: string): boolean {
  return VISIBLE_ASCII.test(key);
}

export class IdempotencyKeys {
  constructor(
    private readonly database: Database,
    private readonly ttlSeconds: number,
  ) {}

  /**
   * Takes the key for this account, or reports the stored answer. A key seen
   * on another session or through the other version is refused.
   */
  async claim(account: number, key: string, version: ApiVersion, sessionId: string): Promise<KeyClaim> {
    await this.database.query(
      'DELETE FROM idempotency_keys WHERE account_id = $1 AND key = $2 AND first_used_at <= now() - make_interval(secs => $3)',
      [account, key, this.ttlSeconds],
    );
    try {
      await this.database.query(
        `INSERT INTO idempotency_keys (account_id, key, api_version, session_id) VALUES ($1, $2, $3, $4)`,
        [account, key, version, sessionId],
      );
      return { kind: 'claimed' };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const existing = await this.database.query<{
      api_version: ApiVersion;
      session_id: string;
      status: number | null;
      body: string | null;
    }>('SELECT api_version, session_id, status, body FROM idempotency_keys WHERE account_id = $1 AND key = $2', [
      account,
      key,
    ]);
    const row = existing.rows[0];
    if (row === undefined) return this.claim(account, key, version, sessionId);
    if (row.api_version !== version || row.session_id !== sessionId) throw conflict('idempotency_key_reused');
    if (row.status === null || row.body === null) throw conflict('request_in_progress');
    return { kind: 'replay', status: row.status, body: row.body };
  }

  /** Recorded in the same transaction that stores the reservation. */
  async record(tx: Queryable, account: number, key: string, status: number, body: string): Promise<void> {
    await tx.query('UPDATE idempotency_keys SET status = $3, body = $4 WHERE account_id = $1 AND key = $2', [
      account,
      key,
      status,
      body,
    ]);
  }

  async release(account: number, key: string): Promise<void> {
    await this.database.query(
      'DELETE FROM idempotency_keys WHERE account_id = $1 AND key = $2 AND status IS NULL',
      [account, key],
    );
  }
}
