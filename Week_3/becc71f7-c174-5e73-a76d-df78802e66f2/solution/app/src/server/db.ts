import pg from "pg";
import { config } from "./config";

// `date` columns stay the Brussels date strings the domain works in.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });

export type Db = pg.Pool | pg.PoolClient;

export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
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

/** Serialises this transaction with every other one holding the same key, until it ends. */
export async function lockKey(db: pg.PoolClient, key: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}
