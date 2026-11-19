// Postgres access: pool, transactional helpers and idempotent schema apply.

import pg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

const { Pool } = pg;

export class Db {
  private pool: pg.Pool;
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    this.pool.on('error', () => {
      // A background idle-client error must not take the server down.
    });
  }

  get raw(): pg.Pool {
    return this.pool;
  }

  async query<Row extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.query(sql, params) as Promise<QueryResult<Row>>;
  }

  async one<Row extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<Row | null> {
    const result = await this.query<Row>(sql, params);
    return result.rows[0] ?? null;
  }

  /** Runs fn inside a transaction, retrying on serialization or deadlock. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Connection already broken; the original error matters.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Applies the schema once per process, safe for two instances starting together. */
  applySchema(sql: string): Promise<void> {
    if (this.schemaReady) return this.schemaReady;
    this.schemaReady = (async () => {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [981723]);
        try {
          await client.query(sql);
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [981723]);
        }
      } finally {
        client.release();
      }
    })();
    return this.schemaReady;
  }

  async check(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
