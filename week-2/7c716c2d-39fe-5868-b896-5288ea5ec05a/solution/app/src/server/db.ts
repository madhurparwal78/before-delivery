// Postgres access: one pool, transactions that always release their client, and the mapping
// from "the database can't be reached" to the API's database_unavailable.
import pg from "pg";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

pg.types.setTypeParser(20, (value: string) => Number(value)); // bigint ids fit in a double
pg.types.setTypeParser(1082, (value: string) => value); // dates stay YYYY-MM-DD strings

type Row = Record<string, unknown>;
export type Db = Pick<pg.PoolClient, "query">;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 3000,
});
pool.on("error", () => undefined); // an idle client dropped by the server is simply discarded
pool.on("connect", (client) => client.on("error", () => undefined)); // a checked-out one fails its query instead

let schemaReady = false;
export function markSchemaReady(): void {
  schemaReady = true;
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE", "EAI_AGAIN"]);

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && (CONNECTION_CODES.has(code) || code.startsWith("08") || code === "57P01" || code === "57P03" || code === "3D000" || code === "28P01")) return true;
  return /timeout|terminated|Connection terminated|connect/i.test(error.message) && !(error instanceof ApiError);
}

function unavailable(error: unknown): never {
  if (isConnectionError(error)) throw new ApiError("database_unavailable");
  throw error;
}

async function connect(): Promise<pg.PoolClient> {
  if (!schemaReady) throw new ApiError("database_unavailable");
  try {
    return await pool.connect();
  } catch (error) {
    return unavailable(error);
  }
}

export async function query<T extends pg.QueryResultRow = Row>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = await connect();
  try {
    const result = await client.query<T>(text, values);
    return result.rows;
  } catch (error) {
    return unavailable(error);
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow = Row>(text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, values))[0];
}

const RETRYABLE = new Set(["40001", "40P01"]);

/** Runs `work` in one transaction; the client is released on every path, rolled back on any throw. */
export async function tx<T>(work: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && RETRYABLE.has(code) && attempt < 4) continue;
      if (error instanceof ApiError) throw error;
      return unavailable(error);
    } finally {
      client.release(broken);
    }
  }
}

/** Runs `work` holding a session-level advisory lock and no transaction, so slow calls to
 * another service never leave a session idle in a transaction. */
export async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const client = await connect();
  let broken = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => {
        broken = true;
      });
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return unavailable(error);
  } finally {
    client.release(broken);
  }
}

/** A raw connection used only by boot-time steps that run before the schema is ready. */
export async function bootQuery(text: string, values: unknown[] = []): Promise<pg.QueryResult> {
  const client = await pool.connect();
  try {
    return await client.query(text, values);
  } finally {
    client.release();
  }
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await bootQuery("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
