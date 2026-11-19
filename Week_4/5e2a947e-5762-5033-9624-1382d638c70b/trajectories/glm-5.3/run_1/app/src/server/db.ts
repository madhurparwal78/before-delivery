import pg from 'pg';
import type { PoolClient } from 'pg';

/** A thin typed query helper over the pg pool. */
export class Db {
  pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 20 });
  }

  async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  async one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const r = await this.query<T>(sql, params);
    return r.rows[0] ?? null;
  }

  async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}
