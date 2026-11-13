import pg from 'pg';
import { config } from './config';
import { ApiError, STORE_DOWN } from './errors';
import { SCHEMA } from './schema';
import { applySeed } from './seed';

export type Db = pg.PoolClient;

const STORE_LOCK = 7_201_114;
const OUTAGE_SQLSTATES = /^(08|53|57P|3D)/;
let pool: pg.Pool | null = null;
let ready: Promise<void> | null = null;

/** Every route that needs Postgres passes through here, so a late or broken database stays a 503 and never a crash. */
function storeUnavailable(): ApiError {
  return new ApiError(503, 'store_unavailable', STORE_DOWN);
}

function isOutage(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return OUTAGE_SQLSTATES.test(code) || /^(E[A-Z]+)$/.test(code);
  return error instanceof Error && /connect|terminat|timeout|password|database/i.test(error.message);
}

function poolOf(): pg.Pool {
  if (pool === null) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 3000 });
    pool.on('error', () => undefined);
  }
  return pool;
}

async function prepareStore(): Promise<void> {
  const client = await poolOf().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [STORE_LOCK]);
    await client.query(SCHEMA);
    await applySeed(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [STORE_LOCK]).catch(() => undefined);
    client.release();
  }
}

export async function storeReady(): Promise<void> {
  ready ??= prepareStore().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  await ready;
}

async function connected<T>(work: (client: Db) => Promise<T>): Promise<T> {
  let client: Db;
  try {
    await storeReady();
    client = await poolOf().connect();
  } catch {
    throw storeUnavailable();
  }
  try {
    return await work(client);
  } catch (error) {
    throw isOutage(error) ? storeUnavailable() : error;
  } finally {
    client.release();
  }
}

export async function query<Row extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<Row[]> {
  return connected(async (client) => (await client.query<Row>(text, values)).rows);
}

export async function transaction<T>(work: (client: Db) => Promise<T>): Promise<T> {
  return connected(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

export async function storeReachable(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
