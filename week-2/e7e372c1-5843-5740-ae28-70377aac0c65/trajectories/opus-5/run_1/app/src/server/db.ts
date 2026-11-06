import { Pool, PoolClient, QueryResultRow } from 'pg';
import { loadConfig } from './config';

const config = loadConfig();

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

pool.on('error', () => {
  // A broken idle connection is dropped from the pool; the next query reconnects.
});

export type QueryParameter = string | number | boolean | Date | null | string[];

export async function query<T extends QueryResultRow>(
  text: string,
  parameters: readonly QueryParameter[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, parameters as QueryParameter[]);
  return result.rows;
}

export interface Transaction {
  query<T extends QueryResultRow>(text: string, parameters?: readonly QueryParameter[]): Promise<T[]>;
}

export async function transact<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  const tx: Transaction = {
    async query<R extends QueryResultRow>(text: string, parameters: readonly QueryParameter[] = []) {
      const result = await client.query<R>(text, parameters as QueryParameter[]);
      return result.rows;
    },
  };
  try {
    await client.query('BEGIN');
    const value = await run(tx);
    await client.query('COMMIT');
    return value;
  } catch (failure) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw failure;
  } finally {
    client.release();
  }
}

/** Serialises schema application and seed replay across app copies. */
export async function withAdvisoryLock<T>(lockKey: number, run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    return await run();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
    client.release();
  }
}

export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(failure: unknown): boolean {
  return (
    typeof failure === 'object' &&
    failure !== null &&
    (failure as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export function uniqueViolationConstraint(failure: unknown): string | null {
  if (typeof failure !== 'object' || failure === null) return null;
  const constraint = (failure as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : null;
}
