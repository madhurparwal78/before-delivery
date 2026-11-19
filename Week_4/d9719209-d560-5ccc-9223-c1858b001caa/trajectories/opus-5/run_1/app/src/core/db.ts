import pg from 'pg';
import { config } from './config.js';
import { SCHEMA_SQL } from './schema.js';

// Keep bigint columns as JavaScript strings so ids survive without precision loss,
// and read integer counters as numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => value);

export type Row = Record<string, unknown>;

/** Query result rows are plain objects; each caller names the columns it selected. */
export type RowShape = object;

export interface Queryable {
  query<T extends RowShape = Row>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 16,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
});

pool.on('error', () => {
  // A broken idle connection is replaced by the pool; requests surface their own failure.
});

export const db: Queryable = {
  async query<T extends RowShape = Row>(text: string, values: unknown[] = []) {
    const result = await pool.query(text, values);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  },
};

export async function transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Queryable = {
    async query<R extends RowShape = Row>(text: string, values: unknown[] = []) {
      const result = await client.query(text, values);
      return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
    },
  };
  try {
    await client.query('begin');
    const value = await run(tx);
    await client.query('commit');
    return value;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // the connection is already broken; releasing it below discards it
    }
    throw error;
  } finally {
    client.release();
  }
}

let ready = false;

export function databaseReady(): boolean {
  return ready;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await db.query('select 1');
    return true;
  } catch {
    return false;
  }
}

/** Applies the schema, then the seed, and keeps retrying while Postgres is unreachable. */
export async function startDatabase(seed: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await db.query(SCHEMA_SQL);
      await seed();
      ready = true;
      return;
    } catch (error) {
      ready = false;
      process.stderr.write(`database not ready: ${(error as Error).message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function one<T extends RowShape = Row>(
  source: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const result = await source.query<T>(text, values);
  return result.rows[0] ?? null;
}

export async function many<T extends RowShape = Row>(
  source: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await source.query<T>(text, values);
  return result.rows;
}
