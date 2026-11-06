import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { config } from "./config";

// DATE columns arrive as YYYY-MM-DD strings, never shifted into a timezone.
pg.types.setTypeParser(1082, (v: string) => v);

export const pool: Pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
});

export type Db = Pool | PoolClient;

export async function q<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(sql, params as never[]);
  return res.rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await q<T>(db, sql, params);
  return rows[0];
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already gone */
    }
    throw e;
  } finally {
    client.release();
  }
}

// Advisory lock keys: stable 32-bit ints derived from names / ids.
export function lockKey(name: string): number {
  const h = createHash("md5").update(name).digest();
  return h.readUInt32BE(0) | 0;
}

// Serialize work scoped to a name across instances, inside a transaction.
export async function withLock<T>(client: PoolClient, name: string, fn: () => Promise<T>): Promise<T> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey(name)]);
  return fn();
}

// Try a lock; returns false when another instance holds it.
export async function tryLock(client: PoolClient, name: string): Promise<boolean> {
  const res = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS ok", [lockKey(name)]);
  return res.rows[0].ok;
}
