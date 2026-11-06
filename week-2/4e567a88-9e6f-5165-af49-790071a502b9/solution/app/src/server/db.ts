// The Postgres pool. bigint columns come back as BigInt so money never passes through a float.

import { reason } from "./log";
import pg from "pg";
import { config } from "./config";

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => BigInt(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error(`database connection lost (${reason(error)})`));

export type Db = pg.Pool | pg.PoolClient;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

/** Runs `work` in one transaction; any throw rolls it back. */
export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


/** The row a statement always returns (INSERT ... RETURNING, aggregates). */
export async function single<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await rows<T>(db, sql, params);
  return row;
}
