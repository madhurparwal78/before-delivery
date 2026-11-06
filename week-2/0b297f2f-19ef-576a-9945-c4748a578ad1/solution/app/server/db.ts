import pg from "pg";
import { config } from "./config.js";
import { ApiError, databaseUnavailable } from "./errors.js";
import { SCHEMA_SQL, seed } from "./schema.js";

export type Db = pg.PoolClient;

// Calendar dates stay plain YYYY-MM-DD strings, never shifted through a local-time Date.
pg.types.setTypeParser(1082, (value: string) => value);

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 2500,
  idleTimeoutMillis: 10_000,
  query_timeout: 15_000,
});
// An idle client whose connection drops is discarded by the pool; nothing else to do here.
pool.on("error", () => undefined);
// A checked-out client whose connection drops between queries emits "error" too; its next query
// fails with a connection error, which withClient turns into 503 and releases as broken.
pool.on("connect", (client) => {
  client.on("error", () => undefined);
});

let ready = false;
let preparing: Promise<void> | null = null;

const SETUP_LOCK = 72_034_115;

/** True when an error means the database could not be reached, rather than a refused statement. */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error) || error instanceof ApiError) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return code.startsWith("08") || code.startsWith("57P") || code.startsWith("28") || code === "3D000";
  }
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) return true;
  return /connect|connection|terminated|timeout/i.test(error.message);
}

async function prepare(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SETUP_LOCK]);
    try {
      await client.query(SCHEMA_SQL);
      await client.query("BEGIN");
      await seed(client);
      await client.query("COMMIT");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SETUP_LOCK]);
    }
    ready = true;
  } finally {
    client.release();
  }
}

/** Applies schema and seed once the database answers; every data route waits on it. */
export async function ensureReady(): Promise<void> {
  if (ready) return;
  preparing ??= prepare().finally(() => {
    preparing = null;
  });
  try {
    await preparing;
  } catch (error) {
    if (isConnectionError(error)) throw databaseUnavailable();
    throw error;
  }
}

export function isReady(): boolean {
  return ready;
}

async function withClient<T>(fn: (client: Db) => Promise<T>): Promise<T> {
  await ensureReady();
  let client: Db;
  try {
    client = await pool.connect();
  } catch {
    throw databaseUnavailable();
  }
  let broken: Error | undefined;
  try {
    return await fn(client);
  } catch (error) {
    if (isConnectionError(error)) {
      broken = error as Error;
      throw databaseUnavailable();
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

export function read<T>(fn: (client: Db) => Promise<T>): Promise<T> {
  return withClient(fn);
}

export function transaction<T>(fn: (client: Db) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

/** One round trip to see whether the database answers (Services: status probe). */
export async function probeDatabase(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      client.release();
      return true;
    } catch (error) {
      client.release(error as Error);
      return false;
    }
  } catch {
    return false;
  }
}
