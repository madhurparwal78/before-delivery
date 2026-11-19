import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
// An idle client losing its connection is replaced on the next checkout; it must not stop the process.
pool.on("error", (error) => console.warn(`postgres idle client: ${error.message}`));

export type Db = pg.Pool | pg.PoolClient;

/** Runs `work` in one transaction; rolls back on any throw. */
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

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query<T>(sql, params);
  return result.rows[0] ?? null;
}

/** For statements that always yield a row (INSERT … RETURNING, aggregates). */
export async function returning<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<T>(sql, params);
  const first = result.rows[0];
  if (!first) throw new Error("statement returned no row");
  return first;
}

export async function many<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Postgres timestamptz values come back as Date; the API speaks millisecond ISO strings. */
export const iso = (value: Date): string => value.toISOString();
export const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);
