import pg from "pg";
import { config } from "./config.js";

// DATE and BIGINT columns come back as plain strings and numbers; the agency date is never shifted by a JS time zone.
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });
pool.on("error", () => {
  // An idle client dropped by the server; the pool replaces it on next use.
});

export type Db = pg.Pool | pg.PoolClient;

export async function rows<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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
