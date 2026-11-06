// PostgreSQL access: one pool, whole-request transactions, outage detection and recovery.
import pg from 'pg';
import { config } from './config';
import { DatabaseUnavailable } from './errors';

pg.types.setTypeParser(20, (value: string) => Number(value));

export type Db = pg.PoolClient;

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 24,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000,
});
pool.on('error', () => {
  markDown();
});

const state = { ready: false, up: false };

export function databaseUp(): boolean {
  return state.ready && state.up;
}

function markDown(): void {
  state.up = false;
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN',
  '57P01', '57P02', '57P03', '53300', '3D000', '28P01', '28000', '55000',
]);

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && (CONNECTION_CODES.has(code) || code.startsWith('08'))) return true;
  return /Connection terminated|connection error|not queryable|timeout exceeded when trying to connect|Client was closed/i.test(error.message);
}

const RETRYABLE = new Set(['40001', '40P01']);

async function connect(): Promise<Db> {
  try {
    return await pool.connect();
  } catch {
    markDown();
    throw new DatabaseUnavailable();
  }
}

/** Runs `work` in one transaction. Everything it changes commits together or not at all. */
export async function tx<T>(work: (db: Db) => Promise<T>): Promise<T> {
  if (!state.ready) throw new DatabaseUnavailable();
  for (let attempt = 0; ; attempt += 1) {
    const client = await connect();
    let broken = false;
    const onError = (): void => {
      broken = true;
    };
    client.on('error', onError);
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      if (broken || isConnectionFailure(error)) {
        broken = true;
        markDown();
        throw new DatabaseUnavailable();
      }
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && RETRYABLE.has(code) && attempt < 6) continue;
      throw error;
    } finally {
      client.off('error', onError);
      client.release(broken);
    }
  }
}

/** Keeps trying to reach PostgreSQL; once reachable, prepares the schema and seed data. */
export function watchDatabase(prepare: (db: Db) => Promise<void>): void {
  let running = false;
  const probe = async (): Promise<void> => {
    if (running) return;
    running = true;
    let client: Db | null = null;
    try {
      client = await pool.connect();
      if (!state.ready) {
        await prepare(client);
        state.ready = true;
      } else {
        await client.query('SELECT 1');
      }
      state.up = true;
    } catch {
      markDown();
      client?.release(true);
      client = null;
    } finally {
      client?.release();
      running = false;
    }
  };
  void probe();
  setInterval(() => void probe(), 2000).unref();
}
