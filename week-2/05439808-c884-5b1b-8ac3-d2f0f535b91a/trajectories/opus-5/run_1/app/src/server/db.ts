import pg from 'pg';
import { config } from './config.js';
import { ApiError } from './http/errors.js';
import { SCHEMA_SQL } from './schema.js';
import { applySeedData } from './seed.js';

const { Pool, types } = pg;

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

export type Queryable = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<pg.QueryResult<R>>;
};

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '53300',
  '57P01',
  '57P02',
  '57P03',
  '3D000',
  '28000',
  '28P01'
]);

const CONNECTION_ERROR_TEXTS = [
  'connection terminated',
  'connection refused',
  'socket hang up',
  'timeout exceeded when trying to connect',
  'client has encountered a connection error',
  'server closed the connection',
  'connection ended unexpectedly',
  'could not connect',
  'read econnreset',
  'getaddrinfo'
];

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;
  const text = error.message.toLowerCase();
  return CONNECTION_ERROR_TEXTS.some((needle) => text.includes(needle));
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 20000,
  keepAlive: true
});

pool.on('error', (error) => {
  if (isConnectionFailure(error)) markDown();
});

let databaseUp = false;
let readyPromise: Promise<void> | null = null;
let lastFailureAt = 0;
const FAIL_FAST_MS = 2000;

function markDown(): void {
  databaseUp = false;
  readyPromise = null;
  lastFailureAt = Date.now();
}

export function databaseIsUp(): boolean {
  return databaseUp;
}

export function unavailable(): ApiError {
  return new ApiError('database_unavailable');
}

async function prepareDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    await applySeedData(client);
  } finally {
    client.release();
  }
}

async function ensureReady(): Promise<void> {
  if (databaseUp) return;
  if (Date.now() - lastFailureAt < FAIL_FAST_MS) throw unavailable();
  if (!readyPromise) {
    readyPromise = prepareDatabase().then(
      () => {
        databaseUp = true;
      },
      (error) => {
        readyPromise = null;
        throw error;
      }
    );
  }
  await readyPromise;
}

async function probeDatabase(): Promise<boolean> {
  lastFailureAt = 0;
  try {
    await ensureReady();
    await pool.query('SELECT 1');
    databaseUp = true;
    return true;
  } catch {
    markDown();
    return false;
  }
}

export function startDatabaseProbe(): void {
  const tick = (): void => {
    void probeDatabase();
  };
  tick();
  setInterval(tick, 3000).unref();
}

export async function ensureDatabaseReady(): Promise<void> {
  if (databaseUp) return;
  try {
    await ensureReady();
  } catch {
    markDown();
    throw unavailable();
  }
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: readonly unknown[]
): Promise<pg.QueryResult<R>> {
  try {
    await ensureReady();
    return await pool.query<R>(text, values as unknown[]);
  } catch (error) {
    if (isConnectionFailure(error)) {
      markDown();
      throw unavailable();
    }
    throw error;
  }
}

export async function withTransaction<T>(run: (client: Queryable) => Promise<T>): Promise<T> {
  try {
    await ensureReady();
  } catch (error) {
    if (isConnectionFailure(error)) markDown();
    throw unavailable();
  }
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isConnectionFailure(error)) markDown();
    throw unavailable();
  }
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      markDown();
    }
    if (isConnectionFailure(error)) {
      markDown();
      throw unavailable();
    }
    throw error;
  } finally {
    client.release();
  }
}

const LOCK_NAMESPACE = {
  village: 1,
  account: 2,
  clan: 3,
  request: 4,
  throttle: 5
} as const;

export type LockKind = keyof typeof LOCK_NAMESPACE;

export async function takeLock(client: Queryable, kind: LockKind, id: number): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK_NAMESPACE[kind], id]);
}

export async function takeTextLock(client: Queryable, kind: LockKind, text: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCK_NAMESPACE[kind], text]);
}

export async function takeIslandLocks(client: Queryable, villageIds: readonly number[]): Promise<void> {
  const ordered = [...new Set(villageIds)].sort((a, b) => a - b);
  for (const villageId of ordered) {
    await takeLock(client, 'village', villageId);
  }
}
