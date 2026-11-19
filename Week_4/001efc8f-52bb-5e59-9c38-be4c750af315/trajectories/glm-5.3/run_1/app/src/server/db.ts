import pg from 'pg';

export interface SqlClient {
  query: pg.Pool['query'];
}

export class Db {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 20, idleTimeoutMillis: 30000 });
  }

  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection already broken
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
