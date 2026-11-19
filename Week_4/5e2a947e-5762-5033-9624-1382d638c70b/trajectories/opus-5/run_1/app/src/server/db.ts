import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Row = object;

export interface Queryable {
  query<T extends Row = Row>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 30000,
});

pool.on('error', () => {
  /* a broken idle connection is replaced on the next query */
});

let ready = false;

export function databaseReady(): boolean {
  return ready;
}

export const db: Queryable = {
  query: (text, values) => pool.query(text, values) as never,
};

export async function withTransaction<T>(run: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client as unknown as Queryable);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Applies the schema idempotently. Retries every second until the database answers. */
export async function connectAndMigrate(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = await readFile(join(here, 'schema.sql'), 'utf8');
  for (;;) {
    try {
      await pool.query(schema);
      ready = true;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
