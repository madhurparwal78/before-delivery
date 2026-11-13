import { Pool, PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export class Db {
  readonly pool: Pool;
  private ready = false;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  }

  async query<T extends QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      try {
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    } finally {
      c.release();
    }
  }

  markReady(): void {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export type DbClient = PoolClient | Pool;

export async function one<T extends QueryResultRow = Record<string, unknown>>(c: DbClient, sql: string, params?: unknown[]): Promise<T | null> {
  const r = await c.query<T>(sql, params);
  return r.rows[0] ?? null;
}

export async function many<T extends QueryResultRow = Record<string, unknown>>(c: DbClient, sql: string, params?: unknown[]): Promise<T[]> {
  const r = await c.query<T>(sql, params);
  return r.rows;
}
