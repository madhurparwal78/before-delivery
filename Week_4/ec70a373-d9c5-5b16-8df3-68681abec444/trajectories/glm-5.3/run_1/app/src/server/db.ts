import { Pool, types, type PoolClient } from 'pg';
import { SCHEMA_SQL } from './schema.js';
import type { Env } from '../env.js';

export interface Row {
  [key: string]: unknown;
}

// DATE columns arrive as plain YYYY-MM-DD strings, not Date objects.
types.setTypeParser(1082, (value: string): string => value);

export class Database {
  readonly pool: Pool;

  constructor(env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 12,
      idleTimeoutMillis: 30000,
    });
  }

  async query<T extends Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params as never[]);
    return result.rows;
  }

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // the transaction is already gone
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async applySchema(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export type DbClient = PoolClient;

export async function clientQuery<T extends Row>(client: PoolClient, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await client.query<T>(sql, params as never[]);
  return result.rows;
}
