import { Pool, PoolClient } from "pg";
import { Config } from "./config";

export interface PoolWithConfig extends Pool {
  readonly shedlineConfig: Config;
}

export function createPool(config: Config): PoolWithConfig {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  }) as PoolWithConfig;
  (pool as { shedlineConfig: Config }).shedlineConfig = config;
  return pool;
}

export async function withTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is broken; nothing further can be done for it.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Advisory locks taken in a stable order so concurrent multi-lock requests never deadlock. */
export async function lockKeys(client: PoolClient, keys: readonly string[]): Promise<void> {
  const ordered = [...keys].sort();
  for (const key of ordered) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
  }
}

/** Session-scoped advisory locks, held across several transactions of one logical attempt. */
export async function acquireSessionLocks(client: PoolClient, keys: readonly string[]): Promise<void> {
  const ordered = [...keys].sort();
  for (const key of ordered) {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
  }
}

export async function releaseSessionLocks(client: PoolClient, keys: readonly string[]): Promise<void> {
  const ordered = [...keys].sort();
  for (const key of ordered) {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
  }
}
