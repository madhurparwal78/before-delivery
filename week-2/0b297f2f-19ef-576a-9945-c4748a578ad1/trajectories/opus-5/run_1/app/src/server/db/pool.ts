import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config';

export class DatabaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super('database unavailable');
    this.name = 'DatabaseUnavailableError';
    this.cause = cause;
  }
}

const connectionCodes = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EPIPE',
  'EAI_AGAIN',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  '3D000',
]);

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code !== undefined && connectionCodes.has(code)) return true;
  if (code !== undefined) return false;
  return /timeout|terminated|connect|socket|closed/i.test(error.message);
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 8000,
});

pool.on('error', () => {
  /* idle client failures are reported by the next query */
});

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
  let broken = false;
  // A dropped connection reaches the checked-out client as an error event as well as a
  // rejected query; the query result is the one this code reports.
  const noteBroken = (): void => {
    broken = true;
  };
  client.on('error', noteBroken);
  try {
    return await fn(client);
  } catch (error) {
    if (isConnectionFailure(error)) {
      broken = true;
      throw new DatabaseUnavailableError(error);
    }
    throw error;
  } finally {
    client.removeListener('error', noteBroken);
    client.release(broken);
  }
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  return withClient(async (client) => {
    const result = await client.query<T>(sql, params as unknown[]);
    return result.rows;
  });
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    try {
      await client.query('begin');
      const value = await fn(client);
      await client.query('commit');
      return value;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        /* the connection is already gone */
      }
      throw error;
    }
  });
}

export async function probeDatabase(): Promise<boolean> {
  try {
    await query('select 1');
    return true;
  } catch {
    return false;
  }
}
