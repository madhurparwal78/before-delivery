// Postgres access: a shared pool plus the dedicated, labelled stream connections (DP-19).

import pg from 'pg';
import { SCHEMA_SQL } from './schema';

// bigint (oid 20) as number, not string.
pg.types.setTypeParser(20, (v: string) => (v === null ? null : Number(v)));

export type Db = pg.Pool;

export async function createPool(connectionString: string, extra?: Partial<pg.PoolConfig>): Promise<Db> {
  const pool = new pg.Pool({ connectionString, max: 12, idleTimeoutMillis: 120000, ...extra });
  return pool;
}

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
}

export async function connectStream(db: Db, sessionId: string): Promise<pg.PoolClient> {
  // The dedicated, labelled connection: application_name lowfield-stream:<session_id>.
  const client = await db.connect();
  await client.query("SELECT set_config('application_name', $1, false)", [`lowfield-stream:${sessionId}`]);
  return client;
}

export async function releaseStream(client: pg.PoolClient): Promise<void> {
  try {
    client.release();
  } catch {
    /* already released */
  }
}
