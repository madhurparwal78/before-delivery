// Postgres access. Every query passes through `query`/`transaction`, which turn an unreachable
// database into the 503 `database_unavailable` error. The schema is applied before any request uses it.
import pg from "pg";
import { config } from "./config.js";
import { ApiError, databaseUnavailable } from "./http.js";
import { applySchema } from "./schema.js";

pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10_000,
  max: 24,
});
pool.on("error", () => undefined);
// A client that loses its connection while checked out emits "error" itself; its pending query rejects
// with the same error, so the listener only keeps the process alive.
pool.on("connect", (client) => client.on("error", () => undefined));

export type Client = pg.PoolClient;
type Runner = pg.Pool | pg.PoolClient;

function isUnreachable(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code.startsWith("08") || code.startsWith("57P");
  return true;
}

function translate(error: unknown): Error {
  if (error instanceof ApiError) return error;
  return isUnreachable(error) ? databaseUnavailable() : (error as Error);
}

let schemaApplied = false;
let applying: Promise<void> | null = null;

/** Applies schema and seed once per process; concurrent callers share the attempt. */
export async function ensureSchema(): Promise<void> {
  if (schemaApplied) return;
  applying ??= (async () => {
    const client = await pool.connect();
    try {
      await applySchema(client);
      schemaApplied = true;
    } catch (error) {
      client.release(true);
      throw error;
    }
    client.release();
  })().finally(() => {
    applying = null;
  });
  try {
    await applying;
  } catch (error) {
    throw translate(error);
  }
}

export async function query<T>(sql: string, params: unknown[] = [], runner: Runner = pool): Promise<T[]> {
  await ensureSchema();
  try {
    const result = await runner.query(sql, params);
    return result.rows as T[];
  } catch (error) {
    throw translate(error);
  }
}

export async function one<T>(sql: string, params: unknown[] = [], runner: Runner = pool): Promise<T | undefined> {
  return (await query<T>(sql, params, runner))[0];
}

/**
 * Runs `work` inside BEGIN/COMMIT on one client; any throw rolls back. Database errors are already translated
 * by `query`, so errors from other providers inside `work` pass through unchanged.
 */
export async function transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  await ensureSchema();
  let client: Client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw translate(error);
  }
  let broken = false;
  try {
    await query("BEGIN", [], client);
    const result = await work(client);
    await query("COMMIT", [], client);
    return result;
  } catch (error) {
    // `query` has already turned a lost connection into database_unavailable; such a client is not reused.
    broken = error instanceof ApiError && error.code === "database_unavailable";
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(broken);
  }
}

export const isUniqueViolation = (error: unknown): boolean => (error as { code?: unknown }).code === "23505";
