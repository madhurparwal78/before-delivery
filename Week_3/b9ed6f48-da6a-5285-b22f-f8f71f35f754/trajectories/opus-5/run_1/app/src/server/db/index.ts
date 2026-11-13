import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { config } from '../config.js';
import { SCHEMA_STATEMENTS } from './schema.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type QueryValue = string | number | boolean | null | Date | object;

export async function query<Row extends pg.QueryResultRow>(text: string, values: QueryValue[] = []): Promise<Row[]> {
  const result = await pool.query<Row>(text, values);
  return result.rows;
}

export async function queryOne<Row extends pg.QueryResultRow>(
  text: string,
  values: QueryValue[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, values);
  return rows[0] ?? null;
}

export interface Tx {
  query<Row extends pg.QueryResultRow>(text: string, values?: QueryValue[]): Promise<Row[]>;
}

export async function withTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Tx = {
      query: async <Row extends pg.QueryResultRow>(text: string, values: QueryValue[] = []) =>
        (await client.query<Row>(text, values)).rows,
    };
    const result = await run(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function lockKeys(name: string): [number, number] {
  const digest = createHash('sha1').update(name).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * Serialises work across every instance that shares the database. Held for the whole
 * action, so provider calls inside it are serialised too.
 */
export async function withAdvisoryLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  const [first, second] = lockKeys(name);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [first, second]);
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [first, second]);
    }
  } finally {
    client.release();
  }
}

export async function applySchema(): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export async function nextReceiptNumber(): Promise<string> {
  const row = await queryOne<{ nextval: string }>(`SELECT nextval('receipt_number_seq') AS nextval`);
  const value = Number(row?.nextval ?? '1');
  return `HRR-${String(value).padStart(6, '0')}`;
}

export async function readDeploymentState<T>(key: string): Promise<T | null> {
  const row = await queryOne<{ value: T }>('SELECT value FROM deployment_state WHERE key = $1', [key]);
  return row ? row.value : null;
}

export async function writeDeploymentStateOnce<T extends object>(key: string, value: T): Promise<T> {
  await pool.query(
    'INSERT INTO deployment_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
    [key, JSON.stringify(value)],
  );
  const stored = await readDeploymentState<T>(key);
  return stored ?? value;
}
