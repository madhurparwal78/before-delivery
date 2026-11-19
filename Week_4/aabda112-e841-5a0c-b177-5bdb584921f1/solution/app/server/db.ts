import pg from 'pg';
import { config } from './config.js';
import { SCHEMA } from './schema.js';
import { AppError } from './errors.js';

// Counts, sums and sequence columns come back as numbers; nothing here exceeds 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 3000 });
pool.on('error', () => undefined);

export type Db = Pick<pg.PoolClient, 'query'>;

const SCHEMA_LOCK = 7_231_001;

export async function prepareDatabase(afterSchema: (db: Db) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
    try {
      await client.query(SCHEMA);
      await afterSchema(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
    }
  } finally {
    client.release();
  }
}

export async function rows<T = Record<string, any>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T = Record<string, any>>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

/**
 * A write transaction. Every write of a clinic is serialised on that clinic's advisory lock, so simultaneous claims
 * on a slot, a paragraph, a dose or the last units of stock have exactly one winner, in server order.
 */
export async function transaction<T>(clinicId: string | null, work: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [clinicId ?? 'global']);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN']);

export function asDatabaseError(error: unknown): unknown {
  const e = error as { code?: string; message?: string };
  if (error instanceof AppError) return error;
  if (
    (e.code && (UNREACHABLE.has(e.code) || e.code.startsWith('08') || e.code.startsWith('57P') || e.code === '53300')) ||
    /Connection terminated|timeout exceeded when trying to connect|the database system is/i.test(e.message ?? '')
  ) {
    return new AppError('database_unavailable');
  }
  return error;
}

export async function ping(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** One dedicated connection per process that listens to NOTIFY channels and reconnects when it drops. */
export function listen(channel: string, onMessage: (payload: string) => void): void {
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on('error', () => undefined);
    client.on('end', () => setTimeout(() => void connect(), 2000));
    client.on('notification', (m) => {
      if (m.channel === channel && m.payload) onMessage(m.payload);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${channel}`);
    } catch {
      client.removeAllListeners('end');
      await client.end().catch(() => undefined);
      setTimeout(() => void connect(), 2000);
    }
  };
  void connect();
}

export async function notify(db: Db, channel: string, payload: unknown): Promise<void> {
  await db.query('SELECT pg_notify($1, $2)', [channel, JSON.stringify(payload)]);
}
