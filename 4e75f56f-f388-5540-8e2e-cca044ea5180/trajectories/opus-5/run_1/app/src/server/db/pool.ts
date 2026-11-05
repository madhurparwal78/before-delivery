import pg from 'pg';
import { config } from '../config.js';

export type Queryable = Pick<pg.PoolClient, 'query'>;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', () => {
  /* a dropped idle connection is replaced on the next checkout */
});

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const LEDGER_LOCK_KEY = 7_314_221;
const AGENDA_LOCK_KEY = 7_314_222;
const CERTIFICATE_LOCK_KEY = 7_314_223;

async function withAdvisoryLock<T>(key: number, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1)', [key]);
    return fn(client);
  });
}

/** Every claim on a bench or an Atelier place runs inside this lock. */
export const withLedgerLock = <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
  withAdvisoryLock(LEDGER_LOCK_KEY, fn);

/** Agenda writes are checked and written one at a time across every process. */
export const withAgendaLock = <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
  withAdvisoryLock(AGENDA_LOCK_KEY, fn);

/** Certificate numbers are taken one at a time, together with a stored PDF. */
export const withCertificateLock = <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
  withAdvisoryLock(CERTIFICATE_LOCK_KEY, fn);

/** Tries to take a non-blocking lock, so only one process runs a sweep at a time. */
export async function withWorkClaim<T>(
  name: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const claimed = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
      [`ob-work-${name}`],
    );
    if (claimed.rows[0]?.locked !== true) {
      await client.query('rollback');
      return null;
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
