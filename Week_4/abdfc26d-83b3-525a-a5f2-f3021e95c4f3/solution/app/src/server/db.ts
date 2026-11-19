import pg from "pg";
import { config } from "./config.js";

// Counts and sums of integer cents and credits come back as int8/numeric; they stay far inside the safe range.
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 30, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.PoolClient | pg.Pool;
export type Tx = pg.PoolClient;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

/** Runs `work` in one transaction; `after` callbacks run once it has committed. */
export async function tx<T>(work: (client: Tx, after: (fn: () => void) => void) => Promise<T>): Promise<T> {
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
export const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
