import pg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

const { Pool } = pg;

export class Database {
  private readonly pool: InstanceType<typeof Pool>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async rawQuery<T extends QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, [...params]);
  }

  async query<T extends QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, [...params]);
    return result.rows;
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already broken */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async withAdvisoryTransaction<T>(lockKey: number, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
      return fn(client);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
