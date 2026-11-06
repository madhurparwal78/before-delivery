import { Pool } from "pg";
import type { PoolClient } from "pg";

export interface Db {
  pool: Pool;
  query<T extends pgRow = pgRow>(sql: string, params?: unknown[]): Promise<T[]>;
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export type pgRow = Record<string, unknown>;

export function createDb(connectionString: string): Db {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
  });
  const query = async <T extends pgRow = pgRow>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const result = await pool.query<T>(sql, params as never[]);
    return result.rows;
  };
  const withTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection already broken
      }
      throw err;
    } finally {
      client.release();
    }
  };
  return { pool, query, withTransaction, transaction: withTransaction };
}

export function row<T extends pgRow>(rows: T[]): T | null {
  return rows.length > 0 ? rows[0] : null;
}

// Advisory lock helpers: one Postgres advisory lock namespace per key.
function advisoryKey(namespace: string, key: string): bigint {
  // 64-bit signed key from two 32-bit hashes.
  const h1 = hash32(namespace);
  const h2 = hash32(key);
  const combined = (BigInt(h1) << 32n) | BigInt(h2 >>> 0);
  return combined & 0x7fffffffffffffffn;
}

function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function advisoryXactLock(client: PoolClient, namespace: string, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [advisoryKey(namespace, key)]);
}

export async function advisoryLock(client: PoolClient, namespace: string, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1::bigint)", [advisoryKey(namespace, key)]);
}

export async function advisoryUnlock(client: PoolClient, namespace: string, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_unlock($1::bigint)", [advisoryKey(namespace, key)]);
}
