import pg from "pg";
import { config } from "./config.js";

// Postgres is the system of record. Every request that reads or moves money runs in one transaction that
// first takes the ledger lock, so every rule holds across all server processes sharing the database.

const LEDGER_LOCK = 4_173_001;
const SCHEMA_LOCK = 4_173_000;

export type Tx = pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres idle client error:", error.message));

let ready = false;

/** True for a failure of the database itself (unreachable, dropped connection, shutting down), not of our own code. */
export function isDatabaseFailure(error: unknown): boolean {
  if (error instanceof pg.DatabaseError) return /^(08|53|57|58)/.test(error.code ?? "");
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code ?? "";
  return /^(ECONN|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)/.test(code) || /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/.test(error.message);
}

export function isReady(): boolean {
  return ready;
}

export async function rows<T>(tx: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query(sql, params)).rows as T[];
}

export async function one<T>(tx: Tx, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(tx, sql, params))[0];
}

async function transaction<T>(lock: number | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    if (lock !== null) await client.query("SELECT pg_advisory_xact_lock($1)", [lock]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

/** Runs `fn` holding the ledger lock; everything it writes commits together or not at all. */
export function inLedger<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction(LEDGER_LOCK, fn);
}

/** Runs `fn` in a plain transaction without the ledger lock (the notice sender). */
export function unlocked<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction(null, fn);
}

/**
 * Applies the schema and seed exactly once: only into an empty database, under a session lock so two servers
 * starting together against the same empty database cannot both apply it. A non-empty database is left alone.
 */
export async function prepareDatabase(schema: string, seed: (tx: Tx) => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await transaction(SCHEMA_LOCK, async (tx) => {
        const tables = await rows<{ name: string }>(tx, "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'");
        if (tables.length > 0) return;
        await tx.query(schema);
        await seed(tx);
      });
      ready = true;
      return;
    } catch (error) {
      console.error("postgres not ready, retrying in 2 s:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
