import pg from "pg";
import { config } from "./config.js";

// Dates stay as YYYY-MM-DD strings (provider calendar dates); counts and sums arrive as integers.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => parseInt(value, 10));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 40 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export interface Db {
  q<T extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

const viaClient = (client: pg.PoolClient): Db => ({
  q: async <T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []) =>
    (await client.query<T>(sql, [...params])).rows,
});

export const db: Db = {
  q: async <T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []) =>
    (await pool.query<T>(sql, [...params])).rows,
};

export const one = async <T extends pg.QueryResultRow>(
  source: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> => (await source.q<T>(sql, params))[0];

const RETRYABLE = new Set(["40001", "40P01"]);

const sqlState = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;

export const isUniqueViolation = (error: unknown): boolean => sqlState(error) === "23505";

/** Runs `work` in one serialisable transaction, retrying serialisation failures and deadlocks. */
export async function tx<T>(work: (t: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await work(viaClient(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (attempt < 12 && RETRYABLE.has(sqlState(error) ?? "")) {
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20 * attempt));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

type ClaimedTable = "cohorts" | "seat_packs" | "certificates";

/**
 * Serialises writers on one row inside a serialisable transaction. Updating the row (to itself) makes a concurrent
 * writer that committed first raise a serialisation failure here, so `tx` retries on a fresh snapshot instead of
 * deciding on stale counts. Returns false when the row does not exist.
 */
export async function claimRow(t: Db, table: ClaimedTable, id: string): Promise<boolean> {
  return (await t.q(`UPDATE ${table} SET id = id WHERE id = $1 RETURNING id`, [id])).length > 0;
}

/** Serialises work on one key across every app instance sharing the database. */
export async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
    }
  } finally {
    client.release();
  }
}

/** Waits for Postgres at boot, retrying every 2 seconds. */
export async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      console.error("waiting for postgres:", error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
