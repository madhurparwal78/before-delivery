import pg from 'pg';
import { env } from '../env.js';
import { storeUnavailable } from '../http/errors.js';

const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 4_000,
  idleTimeoutMillis: 30_000,
});

pool.on('error', () => {
  /* a dropped idle connection is reported by the next query */
});

export type QueryParam = string | number | boolean | null | Date | Buffer | object;

/** SQLSTATE classes that mean the connection, not the statement, went wrong. */
const CONNECTION_STATES = new Set(['57P01', '57P02', '57P03', '53300', '08000', '08003', '08006']);

function isConnectionFailure(error: unknown): boolean {
  const candidate = error as { severity?: string; code?: string };
  if (candidate.code !== undefined && CONNECTION_STATES.has(candidate.code)) return true;
  return candidate.severity === undefined;
}

function translate(error: unknown): never {
  if (isConnectionFailure(error)) throw storeUnavailable();
  throw error;
}

export async function query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly QueryParam[] = [],
): Promise<Row[]> {
  try {
    const result = await pool.query<Row>(text, params as unknown[]);
    return result.rows;
  } catch (error) {
    return translate(error);
  }
}

export async function queryOne<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly QueryParam[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, params);
  return rows[0] ?? null;
}

export async function execute(text: string, params: readonly QueryParam[] = []): Promise<number> {
  try {
    const result = await pool.query(text, params as unknown[]);
    return result.rowCount ?? 0;
  } catch (error) {
    return translate(error);
  }
}

/**
 * Runs `work` inside one transaction, on one connection. Only failures of the
 * connection itself become a store outage; whatever `work` throws is passed on
 * unchanged, so a Kill Bill or file-store outage keeps its own error.
 */
export async function transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    return translate(error);
  }
  const tx: Transaction = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: readonly QueryParam[] = [],
    ) => {
      try {
        return (await client.query<Row>(text, params as unknown[])).rows;
      } catch (error) {
        return translate(error);
      }
    },
    execute: async (text: string, params: readonly QueryParam[] = []) => {
      try {
        return (await client.query(text, params as unknown[])).rowCount ?? 0;
      } catch (error) {
        return translate(error);
      }
    },
  };
  try {
    try {
      await client.query('BEGIN');
    } catch (error) {
      translate(error);
    }
    const result = await work(tx);
    try {
      await client.query('COMMIT');
    } catch (error) {
      translate(error);
    }
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is already gone */
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Anything that can run a read: the pool itself or one transaction. */
export interface Runner {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: readonly QueryParam[],
  ): Promise<Row[]>;
}

export interface Transaction extends Runner {
  execute(text: string, params?: readonly QueryParam[]): Promise<number>;
}

export async function probeStore(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
