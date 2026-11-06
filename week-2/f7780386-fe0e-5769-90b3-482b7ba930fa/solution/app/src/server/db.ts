// PostgreSQL access: one pool, transactions, and the mapping of an unreachable database to 503.

import pg from "pg";
import { unavailable } from "./errors.js";

pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export type Db = pg.PoolClient;

let pool: pg.Pool | null = null;
let ready = false;

export function openPool(connectionString: string): void {
  pool = new pg.Pool({ connectionString, max: 20, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000 });
  pool.on("error", () => {
    // An idle client lost its connection; the next checkout reconnects.
  });
}

export function markReady(): void {
  ready = true;
}

export function databaseReady(): boolean {
  return ready;
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "57P01", "57P02", "57P03"]);

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  if (code && (CONNECTION_CODES.has(code) || code.startsWith("08"))) return true;
  return /Connection terminated|timeout exceeded when trying to connect|connect ECONNREFUSED/i.test(error.message);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: string }).code === "23505";
}

async function checkout(): Promise<Db> {
  if (!pool) throw unavailable("database_unavailable");
  try {
    return await pool.connect();
  } catch {
    throw unavailable("database_unavailable");
  }
}

/** Runs fn inside one transaction; an unreachable database becomes 503 database_unavailable. */
export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await checkout();
  let broken = false;
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    broken = isConnectionFailure(error);
    if (!broken) await db.query("ROLLBACK").catch(() => undefined);
    if (broken) throw unavailable("database_unavailable");
    throw error;
  } finally {
    db.release(broken);
  }
}
