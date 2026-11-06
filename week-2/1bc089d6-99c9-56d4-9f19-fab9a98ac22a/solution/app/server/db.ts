import pg from "pg";

import { config } from "./config";
import { ApiError } from "./http";
import { SCHEMA } from "./schema";

export type Db = pg.PoolClient;

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 2500,
  idleTimeoutMillis: 10_000,
});
pool.on("error", () => {
  schemaReady = null;
});

let schemaReady: Promise<void> | null = null;

const SCHEMA_LOCK = 724_116_001;

/** Lost connections, refused connections and server shutdowns: the database is unreachable, not the request wrong. */
function isConnectionError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? "";
  return (
    /^(08|57P0|53300)/.test(code) ||
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"].includes(code) ||
    /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error|Connection ended/i.test(
      error.message,
    )
  );
}

/** A table missing after the database was dropped and recreated under us. */
const isMissingTable = (error: unknown) => (error as { code?: string })?.code === "42P01";

async function applySchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function ready() {
  schemaReady ??= applySchema().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

/**
 * Runs `work` on one pooled connection. An unreachable database becomes 503 `unavailable`; the schema
 * is applied on the first successful connection and again if the database was recreated, so the
 * server recovers without a restart.
 */
export async function withDb<T>(work: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    let client: Db | null = null;
    let started = false;
    let broken = false;
    try {
      await ready();
      client = await pool.connect();
      started = true;
      return await work(client);
    } catch (error) {
      broken = isConnectionError(error);
      const retry = isMissingTable(error) || (broken && !started);
      if (retry || broken) schemaReady = null;
      if (retry && attempt === 0) continue;
      if (broken) throw new ApiError("unavailable");
      throw error;
    } finally {
      client?.release(broken);
    }
  }
}

/** Answers 503 `unavailable` unless the database is reachable (and its schema applied) right now. */
export async function ensureDatabase() {
  await withDb(async () => {});
}

/** Runs `work` as one transaction on the connection `db`; any thrown error rolls it back. */
export async function inTransaction<T>(db: Db, work: () => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    const result = await work();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

/** `withDb` inside one transaction. */
export function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  return withDb((db) => inTransaction(db, () => work(db)));
}

export async function closeDb() {
  await pool.end();
}
