import pg from "pg";
import { config } from "./config.js";

// Dates stay `YYYY-MM-DD` strings (never shifted through a JS Date); counts and sums are numbers.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

export async function rows<R extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<R[]> {
  return (await db.query<R>(sql, params)).rows;
}

export async function one<R extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<R | null> {
  return (await db.query<R>(sql, params)).rows[0] ?? null;
}

/** A statement that always yields exactly one row (a primary-key read, an INSERT … RETURNING). */
export async function only<R extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<R> {
  const result = await db.query<R>(sql, params);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) throw new Error(`expected one row from: ${sql.trim().slice(0, 80)}`);
  return row;
}

/** Runs `work` in one database transaction: every multi-step change commits together or not at all. */
export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
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

export function isExclusionViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "23P01";
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "23505";
}
