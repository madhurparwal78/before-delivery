import { Pool, type PoolClient } from 'pg';
import type { DbRow, SQLParam } from './querier';
import { Transaction, withTimeout } from './querier';

const TIMEOUT_MS = 20000;

/**
 * Postgres access with one pool of at most 12 connections (DP-83). Transactions
 * take one client; read helpers borrow one only for the duration of a query.
 */
export class Database implements TxSource {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
    });
    this.pool.on('error', () => {
      /* a broken idle client is replaced by the pool */
    });
  }

  async query<T extends DbRow>(sql: string, params?: SQLParam[]): Promise<T[]> {
    const res = await withTimeout(this.pool.query(sql, params as never[]), TIMEOUT_MS);
    return res.rows as T[];
  }

  async queryOne<T extends DbRow>(sql: string, params?: SQLParam[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0]! : null;
  }

  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = (await withTimeout(this.pool.connect(), TIMEOUT_MS)) as PoolClient;
    try {
      await client.query('BEGIN');
      const result = await work(new Transaction(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* the connection is already broken */
      }
      throw err;
    } finally {
      client.release(true);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface TxSource {
  query<T extends DbRow>(sql: string, params?: SQLParam[]): Promise<T[]>;
  queryOne<T extends DbRow>(sql: string, params?: SQLParam[]): Promise<T | null>;
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
