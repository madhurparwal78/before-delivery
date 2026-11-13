import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';

export interface StorageLike {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  ping(): Promise<boolean>;
}

export interface KillBillLike {
  ensureAccount(externalKey: string, name: string, email: string): Promise<string | null>;
  hasDefaultPaymentMethod(accountId: string): Promise<boolean>;
  addPaymentMethod(accountId: string, externalId: string): Promise<string | null>;
  purchase(accountId: string, amountCents: number, paymentExternalKey: string): Promise<{ kind: string; paymentId?: string }>;
  refund(accountId: string, paymentId: string, amountCents: number): Promise<{ kind: string; paymentId?: string }>;
  ping(): Promise<boolean>;
}

export class Actions {
  constructor(private readonly pool: Pool) {}

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /** Allocate the next board tag in allocation order, under the counter's lock. */
  async allocateTag(client: PoolClient): Promise<string> {
    await client.query('UPDATE tag_counter SET next_value = next_value + 1 WHERE id = 1 RETURNING next_value - 1 AS value');
    const result = await client.query('SELECT next_value - 1 AS value FROM tag_counter WHERE id = 1');
    const value = result.rows[0].value as number;
    return `KW-${String(value).padStart(4, '0')}`;
  }

  async allocateId(client: PoolClient, kind: 'hold' | 'ticket' | 'invoice' | 'photo', prefix: string, width: number): Promise<string> {
    await client.query('UPDATE id_counters SET next_value = next_value + 1 WHERE kind = $1 RETURNING next_value - 1 AS value', [kind]);
    const result = await client.query('SELECT next_value - 1 AS value FROM id_counters WHERE kind = $1', [kind]);
    const value = result.rows[0].value as number;
    return `${prefix}${String(value).padStart(width, '0')}`;
  }

  async rateForBoard(client: PoolClient, species: string, grade: string): Promise<number | null> {
    const result = await client.query(
      `SELECT rate_cents FROM rate_versions WHERE species = $1 AND grade = $2 AND effective_at <= now()
       ORDER BY effective_at DESC, id DESC LIMIT 1`,
      [species, grade],
    );
    return result.rowCount === 1 ? (result.rows[0].rate_cents as number) : null;
  }

  async boardRow(client: PoolClient, tag: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      'SELECT b.*, l.id AS lot_id, l.name AS lot_name, l.origin AS lot_origin, l.built_year FROM boards b JOIN lots l ON l.id = b.lot_id WHERE b.tag = $1 FOR UPDATE',
      [tag],
    );
    return result.rowCount === 1 ? result.rows[0] : null;
  }

  async defectList(client: PoolClient, tag: string): Promise<Array<{ kind: string; start_mm: number; end_mm: number }>> {
    const result = await client.query(
      'SELECT kind, start_mm, end_mm FROM defect_zones WHERE board_tag = $1 ORDER BY position, start_mm, end_mm',
      [tag],
    );
    return result.rows as Array<{ kind: string; start_mm: number; end_mm: number }>;
  }

  /** Release any expired holds on a board, inside the caller's transaction. */
  async releaseExpiredHoldsOnBoard(client: PoolClient, tag: string, now: Date): Promise<void> {
    const result = await client.query(
      `UPDATE holds SET status = 'released', release_reason = 'expired'
       WHERE board_tag = $1 AND status = 'held' AND expires_at <= $2`,
      [tag, now],
    );
    if (result.rowCount && result.rowCount > 0) {
      await client.query(`UPDATE boards SET status = 'available' WHERE tag = $1 AND status = 'held'`, [tag]);
    }
  }
}

export function fingerprint(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method}|${path}|${body}`).digest('hex');
}
