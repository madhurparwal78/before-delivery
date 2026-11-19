// The database: pool, schema application, and helpers.
import pg from 'pg';
import { SCHEMA_SQL } from './schema.js';

const { Pool } = pg;

export type Db = pg.Pool;

let pool: Db | null = null;

export function getDb(connectionString: string): Db {
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000
    });
    pool.on('error', (err) => {
      console.error('pg pool error', err.message);
    });
  }
  return pool;
}

/** Retries until Postgres is reachable and the schema is applied. */
export async function waitForDb(connectionString: string): Promise<Db> {
  const db = getDb(connectionString);
  for (;;) {
    try {
      await db.query('SELECT 1');
      await applySchema(db);
      return db;
    } catch (err) {
      console.error('Postgres not ready:', (err as Error).message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
}
