import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export interface Tx {
  query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
}

export async function withTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx: Tx = {
      async query<R extends QueryResultRow>(sql: string, params: readonly unknown[] = []) {
        const result = await client.query<R>(sql, params as unknown[]);
        return result.rows;
      },
      async queryOne<R extends QueryResultRow>(
        sql: string,
        params: readonly unknown[] = [],
      ): Promise<R | null> {
        const result = await client.query<R>(sql, params as unknown[]);
        return result.rows[0] ?? null;
      },
    };
    const value = await run(tx);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `run` while holding a session-level advisory lock, so only one process does the work. */
export async function withAdvisoryLock<T>(key: number, run: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const got = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [
      key,
    ]);
    if (!got.rows[0]?.locked) return null;
    try {
      return await run();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
