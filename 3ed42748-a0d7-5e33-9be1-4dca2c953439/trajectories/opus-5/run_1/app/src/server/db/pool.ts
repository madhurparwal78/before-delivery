import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config.js';

const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

pool.on('error', () => {
  /* a broken idle connection is dropped and replaced on the next query */
});

let connected = false;

export function databaseIsConnected(): boolean {
  return connected;
}

export async function query<Row extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, values);
  return result.rows;
}

export async function queryOne<Row extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, values);
  return rows[0] ?? null;
}

export interface Transaction {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<Row[]>;
  one<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<Row | null>;
  /** Serialises work sharing a key, so simultaneous requests queue behind each other. */
  lock(key: string): Promise<void>;
}

function wrap(client: PoolClient): Transaction {
  return {
    async query<Row extends QueryResultRow>(text: string, values: unknown[] = []) {
      const result = await client.query<Row>(text, values);
      return result.rows;
    },
    async one<Row extends QueryResultRow>(text: string, values: unknown[] = []) {
      const result = await client.query<Row>(text, values);
      return result.rows[0] ?? null;
    },
    async lock(key: string) {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    },
  };
}

export async function withTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(wrap(client));
    await client.query('commit');
    return result;
  } catch (fault) {
    await client.query('rollback').catch(() => undefined);
    throw fault;
  } finally {
    client.release();
  }
}

/** Keeps trying Postgres until it answers, so the server can boot before it is up. */
export async function connectWithRetry(onConnect: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      await onConnect();
      connected = true;
      return;
    } catch {
      connected = false;
      await new Promise((resume) => setTimeout(resume, 2000));
    }
  }
}
