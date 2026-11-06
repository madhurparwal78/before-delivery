/** What each provider address last answered, kept in PostgreSQL. Instances on one database and address share the row. */
import { one, query, sql, type Db } from './db.js';

export async function recordHealth(address: string, up: boolean): Promise<void> {
  await query(sql, 'INSERT INTO provider_health (address, up) VALUES ($1,$2) ON CONFLICT (address) DO UPDATE SET up = EXCLUDED.up WHERE provider_health.up <> EXCLUDED.up', [address, up]);
}

/** Null until the address has been probed from this database. */
export async function readHealth(db: Db, address: string): Promise<boolean | null> {
  return (await one<{ up: boolean }>(db, 'SELECT up FROM provider_health WHERE address = $1', [address]))?.up ?? null;
}
