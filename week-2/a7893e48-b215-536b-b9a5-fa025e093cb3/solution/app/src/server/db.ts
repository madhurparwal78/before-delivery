import { randomBytes } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("Postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;

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

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query<T>(sql, params);
  return result.rows[0] ?? null;
}

export async function all<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Server-chosen identifiers: a prefix and 12 random hex digits. */
export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}
