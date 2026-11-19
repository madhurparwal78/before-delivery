import pg from 'pg';
import { config } from '../config.js';

// Whole numbers must arrive as numbers, not strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

/** A database row. Each caller names the columns it reads. */
export type Row = Record<string, unknown>;

export async function query<T = Row>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, values);
  return result.rows as T[];
}

export async function one<T = Row>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/** The queries of one open transaction, on the connection that holds it. */
export class Transaction {
  private readonly client: pg.PoolClient;

  constructor(client: pg.PoolClient) {
    this.client = client;
  }

  async query<T = Row>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.client.query(text, values)).rows as T[];
  }

  async one<T = Row>(text: string, values: unknown[] = []): Promise<T | null> {
    return ((await this.client.query(text, values)).rows[0] as T | undefined) ?? null;
  }
}

export async function transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(new Transaction(client));
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** A lock that only one instance can hold, for work that must happen once. */
export async function withSessionLock<T>(key: number, work: () => Promise<T>): Promise<T | 'busy'> {
  const client = await pool.connect();
  try {
    const taken = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!taken.rows[0].locked) return 'busy';
    try {
      return await work();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}

/** A lock that waits its turn, for work that must not run twice at once. */
export async function withWaitingLock<T>(key: number, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [key]);
    try {
      return await work();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}

/** A stable 31-bit lock key for a car and a purpose. */
export function lockKey(purpose: string, id: string): number {
  let hash = 2166136261;
  for (const character of `${purpose}:${id}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash & 0x7fffffff;
}
