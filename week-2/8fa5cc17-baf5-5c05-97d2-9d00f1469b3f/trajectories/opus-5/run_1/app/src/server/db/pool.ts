import { Pool, PoolClient, QueryResultRow } from 'pg';
import { SCHEMA_SQL } from './schema';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

let schemaReady = false;

export function isDatabaseReady(): boolean {
  return schemaReady;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as never[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length === 0 ? null : rows[0];
}

export type Tx = {
  query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>;
};

export async function withTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  const tx: Tx = {
    async query<R extends QueryResultRow>(text: string, params: unknown[] = []): Promise<R[]> {
      const result = await client.query<R>(text, params as never[]);
      return result.rows;
    },
    async one<R extends QueryResultRow>(text: string, params: unknown[] = []): Promise<R | null> {
      const rows = await this.query<R>(text, params);
      return rows.length === 0 ? null : rows[0];
    },
  };
  try {
    await client.query('begin');
    const result = await run(tx);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // the connection is already gone
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Apply the schema, then the seed data, retrying until the database answers. */
export async function prepareDatabase(applySeed: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await pool.query(SCHEMA_SQL);
      await applySeed();
      schemaReady = true;
      return;
    } catch (error) {
      schemaReady = false;
      process.stderr.write(`database not ready: ${(error as Error).message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
