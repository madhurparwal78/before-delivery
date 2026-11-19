import pg from 'pg';
import { config } from './config.js';

export type Row = Record<string, unknown>;

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type Queryable = {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: Row[]; rowCount: number }>;
};

export async function query(text: string, values: readonly unknown[] = []): Promise<Row[]> {
  const result = await pool.query(text, values as unknown[]);
  return result.rows as Row[];
}

async function queryOne(text: string, values: readonly unknown[] = []): Promise<Row | null> {
  const rows = await query(text, values);
  return rows[0] ?? null;
}

export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Queryable = {
      query: async (text, values = []) => {
        const result = await client.query(text, values as unknown[]);
        return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
      },
    };
    const value = await run(tx);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type TransactionHandle = {
  tx: Queryable;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

/**
 * A transaction whose commit is driven by the caller, so order placement can store its
 * document while the transaction is still open.
 */
export async function beginTransaction(): Promise<TransactionHandle> {
  const client = await pool.connect();
  await client.query('BEGIN');
  let finished = false;
  const tx: Queryable = {
    query: async (text, values = []) => {
      const result = await client.query(text, values as unknown[]);
      return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
    },
  };
  return {
    tx,
    commit: async () => {
      if (finished) return;
      finished = true;
      await client.query('COMMIT');
      client.release();
    },
    rollback: async () => {
      if (finished) return;
      finished = true;
      await client.query('ROLLBACK');
      client.release();
    },
  };
}

export async function serverNow(): Promise<Date> {
  const row = await queryOne('SELECT now() AS now');
  return row!['now'] as Date;
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

