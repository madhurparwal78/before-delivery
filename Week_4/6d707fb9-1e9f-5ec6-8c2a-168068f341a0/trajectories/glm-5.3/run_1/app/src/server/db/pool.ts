import pg from "pg";

export type { pg };
import type { Config } from "../config/env.js";

let pool: pg.Pool | null = null;

export function initDb(config: Config): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
  });
  return pool;
}

export function db(): pg.Pool {
  if (!pool) throw new Error("database not initialised");
  return pool;
}

export async function q<T extends pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
  return db().query<T>(text, params as unknown[]);
}

export async function one<T extends pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<T | null> {
  const r = await q<T>(text, params);
  return r.rows[0] ?? null;
}

export async function rows<T extends pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
  const r = await q<T>(text, params);
  return r.rows;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
