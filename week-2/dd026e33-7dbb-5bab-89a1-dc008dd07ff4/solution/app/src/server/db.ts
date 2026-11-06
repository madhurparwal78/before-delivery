// Postgres access: one pool per process, transactions for every change.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";

// Date-only columns stay calendar days ("2026-11-03"); no time zone ever shifts them.
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 24,
  idleTimeoutMillis: 10_000,
  // A transaction left idle by a crashed request is ended by the server, never kept.
  idle_in_transaction_session_timeout: 30_000,
});
pool.on("error", (error: Error) => {
  console.error(`postgres pool: ${error.message}`);
});

export type Db = pg.Pool | pg.PoolClient;
type Row = Record<string, unknown>;

/** Runs `work` in one transaction; commits on success, rolls back on any throw. */
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

export async function one<T extends Row>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query(sql, params);
  return (result.rows[0] as T | undefined) ?? null;
}

export async function many<T extends Row>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

/** A new record id with the given prefix, e.g. "c-3f9a1b2c7d". */
export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

export function iso(value: unknown): string {
  return (value as Date).toISOString();
}

export function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : (value as Date).toISOString();
}

/** True when a Postgres error is a unique violation of the named constraint or index. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e.code === "23505" && e.constraint === constraint;
}
