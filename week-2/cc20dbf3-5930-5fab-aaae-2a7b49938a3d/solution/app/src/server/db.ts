// The PostgreSQL pool. Every record lives here; transactions and row/advisory locks decide races.

import pg from "pg";
import { config } from "./config.js";
import { describeError } from "./log.js";

const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 30 });
pool.on("error", (error: Error) => console.error(`database client error: ${describeError(error)}`));

export type Db = pg.PoolClient;

/** Runs `work` in one transaction on a client the caller already holds. */
export async function transactionOn<T>(db: Db, work: (db: Db) => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

export async function withTransaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    return await transactionOn(db, work);
  } finally {
    db.release();
  }
}

/** Serialises work on one key (an item, a member) until the surrounding transaction ends. */
export async function lockKey(db: Db, scope: "item" | "member", key: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${scope}:${key}`]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for PostgreSQL, retrying every 2 seconds. */
export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      console.error(`database unreachable, retrying in 2 s: ${describeError(error)}`);
      await sleep(2000);
    }
  }
}
