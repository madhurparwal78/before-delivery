import pg from "pg";
import { config } from "./config.js";

// Bigint columns (cents) come back as JS numbers: every amount the brief allows is below 2^53.
pg.types.setTypeParser(20, (value: string) => Number(value));
// Calendar dates stay `YYYY-MM-DD` strings; no time zone is ever applied to them.
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;
type Row = Record<string, unknown>;

export async function rows<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query(sql, params)).rows[0] as T | undefined;
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
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
