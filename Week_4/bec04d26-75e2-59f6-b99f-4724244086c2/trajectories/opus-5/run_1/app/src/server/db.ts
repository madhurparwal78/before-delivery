import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (error) => {
  console.error('postgres pool error', error.message);
});

export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

export interface Tx {
  query<T extends QueryResultRow>(text: string, params?: readonly unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow>(text: string, params?: readonly unknown[]): Promise<T | null>;
}

export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  const tx: Tx = {
    async query<R extends QueryResultRow>(text: string, params: readonly unknown[] = []) {
      const result = await client.query<R>(text, params as unknown[]);
      return result.rows;
    },
    async queryOne<R extends QueryResultRow>(text: string, params: readonly unknown[] = []) {
      const rows = await tx.query<R>(text, params);
      return rows.length > 0 ? rows[0] : null;
    },
  };
  try {
    await client.query('BEGIN');
    const value = await run(tx);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function postgresReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Retries every 2 seconds until Postgres answers, so the app serves once it connects. */
export async function waitForPostgres(): Promise<void> {
  for (;;) {
    if (await postgresReachable()) return;
    console.error('postgres unreachable, retrying in 2 seconds');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
