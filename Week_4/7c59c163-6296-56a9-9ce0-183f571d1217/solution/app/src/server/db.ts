import pg from "pg";
import { config } from "./config.js";

// int8 (bigint) sums come back as JavaScript numbers; every amount stays far inside the safe range.
pg.types.setTypeParser(20, (value) => Number(value));
// numeric results of SUM(int) are also integers here.
pg.types.setTypeParser(1700, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.PoolClient | pg.Pool;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

/** Runs `work` in one transaction; callbacks queued with `after` run once it has committed. */
export async function tx<T>(work: (client: pg.PoolClient, after: (fn: () => void) => void) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const callbacks: (() => void)[] = [];
  try {
    await client.query("BEGIN");
    const result = await work(client, (fn) => callbacks.push(fn));
    await client.query("COMMIT");
    for (const fn of callbacks) fn();
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
