import pg from 'pg';
import { config } from './config.ts';
import { ApiError, ValidationError } from '../domain/errors.ts';

const { Pool, types } = pg;

// Keep bigint and numeric columns as exact text, parsed into exact decimals.
types.setTypeParser(20, (value) => value);
types.setTypeParser(1700, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

pool.on('error', () => {
  // A broken idle connection is replaced by the pool; requests retry.
});

export type Client = pg.PoolClient;
export type Queryable = Pick<pg.PoolClient, 'query'>;

let schemaReady = false;

export function isSchemaReady(): boolean {
  return schemaReady;
}

export function markSchemaReady(): void {
  schemaReady = true;
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  try {
    return await pool.query<T>(text, values as unknown[]);
  } catch (cause) {
    throw asDatabaseError(cause);
  }
}

/** One guarded step: every rule that must settle together runs inside this. */
export async function transaction<T>(run: (client: Client) => Promise<T>): Promise<T> {
  let client: Client;
  try {
    client = await pool.connect();
  } catch (cause) {
    throw asDatabaseError(cause);
  }
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (cause) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already gone; releasing it is enough.
    }
    throw cause instanceof ApiError || cause instanceof ValidationError ? cause : asDatabaseError(cause);
  } finally {
    client.release();
  }
}

function asDatabaseError(cause: unknown): unknown {
  if (cause instanceof ApiError) return cause;
  const code = (cause as { code?: string }).code;
  if (code !== undefined && /^(08|57P|53)/.test(code)) return new ApiError('database_unavailable');
  if (cause instanceof Error && /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|terminat|Connection terminated/i.test(cause.message)) {
    return new ApiError('database_unavailable');
  }
  return cause;
}
