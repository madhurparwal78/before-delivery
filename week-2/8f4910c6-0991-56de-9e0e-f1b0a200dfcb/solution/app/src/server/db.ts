// PostgreSQL pool, transactions and connection retry.

import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(20, (value) => Number(value)); // int8 → number (cents stay far below 2^53)
pg.types.setTypeParser(1082, (value) => value); // date → "YYYY-MM-DD", never shifted by a zone

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool error", error.message));

export type Db = pg.Pool | pg.PoolClient;
export type Row = Record<string, unknown>;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await db.query(sql, params)).rows[0] ?? null;
}

/** One row the caller's own write or a foreign key guarantees. */
export async function the<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query(sql, params)).rows[0];
  if (row === undefined) throw new Error(`expected a row: ${sql.slice(0, 60)}`);
  return row;
}

export async function exec(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  return (await db.query(sql, params)).rowCount ?? 0;
}

/** Runs `work` in one transaction; rolls back on any throw. */
export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises work on one key across every app copy for the rest of the transaction. */
export async function lockKey(client: pg.PoolClient, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

let reachable = false;

export function databaseReachable(): boolean {
  return reachable;
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      reachable = true;
      return;
    } catch (error) {
      console.error("waiting for postgres:", (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
