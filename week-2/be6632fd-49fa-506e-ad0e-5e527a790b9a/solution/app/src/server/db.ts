import pg from "pg";
import { config } from "./config";

pg.types.setTypeParser(20, (value: string) => Number(value)); // bigint: every stored integer fits a double exactly
pg.types.setTypeParser(1082, (value: string) => value); // date stays YYYY-MM-DD

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error: Error) => console.error("postgres pool:", error.message));

export type Db = pg.Pool | pg.PoolClient;
type Row = Record<string, unknown>;

export async function rows<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function one<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

/** Runs `work` in one transaction; a thrown error rolls everything back. */
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

/** Whole-second "now" for every stored instant. */
export function nowSeconds(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}
