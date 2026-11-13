import pg from "pg";
import { config } from "./config";
import { ApiError, databaseUnavailable } from "./errors";
import { SCHEMA } from "./schema";

/** PostgreSQL is the only datastore. The pool connects lazily, so the app boots and serves with the database down. */

const pool = new pg.Pool({
  connectionString: config.databaseUrl || undefined,
  max: 12,
  connectionTimeoutMillis: 2500,
  idleTimeoutMillis: 30000,
});
pool.on("error", () => {
  /* an idle client lost its connection; the next query opens a new one */
});

export type Db = pg.PoolClient;
export type Row = Record<string, unknown>;

const UNREACHABLE = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]);

function isUnreachable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? "";
  if (UNREACHABLE.has(code) || code.startsWith("08") || code.startsWith("57P") || code === "3D000" || code === "28P01") return true;
  if (error instanceof AggregateError) return error.errors.some(isUnreachable);
  return /timeout exceeded when trying to connect|Connection terminated|connect ECONN/i.test(error.message);
}

let migrated = false;
let migrating: Promise<void> | null = null;

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7340211)");
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Applies the schema (idempotently) the first time the database answers. */
async function ready(): Promise<void> {
  if (migrated) return;
  migrating ??= migrate().then(
    () => {
      migrated = true;
      migrating = null;
    },
    (error: unknown) => {
      migrating = null;
      throw error;
    },
  );
  await migrating;
}

function wrap(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (isUnreachable(error)) throw databaseUnavailable();
  throw error;
}

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    await ready();
    const result = await pool.query(sql, params);
    return result.rows as T[];
  } catch (error) {
    return wrap(error);
  }
}

/** Runs `work` inside one transaction on one connection. */
export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  let client: Db;
  try {
    await ready();
    client = await pool.connect();
  } catch (error) {
    return wrap(error);
  }
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return wrap(error);
  } finally {
    client.release();
  }
}

export async function rows<T extends Row = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function databaseAnswers(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === "23505";
}
