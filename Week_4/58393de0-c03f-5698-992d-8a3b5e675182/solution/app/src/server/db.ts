import pg from "pg";
import { config } from "./config";
import { SCHEMA } from "./schema";
import { logged } from "./failures";

export type Queryable = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 3000 });
pool.on("error", () => undefined);

const RETRY_MS = 2000;
let ready = false;

export function databaseReady(): boolean {
  return ready;
}

/** Applies the schema, retrying every 2 seconds until Postgres answers, then hands over to `onReady`. */
export function startDatabase(onReady: () => Promise<void>): void {
  const attempt = async (): Promise<void> => {
    try {
      await pool.query(SCHEMA);
    } catch {
      setTimeout(() => void attempt(), RETRY_MS);
      return;
    }
    ready = true;
    await onReady();
  };
  void attempt();
}

export async function rows<T extends pg.QueryResultRow>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function first<T extends pg.QueryResultRow>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(logged("rollback", undefined));
    throw error;
  } finally {
    client.release();
  }
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND"]);

/** True when an error means Postgres itself cannot be reached, as opposed to a bad statement. */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return (typeof code === "string" && (CONNECTION_CODES.has(code) || code.startsWith("08") || code.startsWith("57P")))
    || error.message.includes("timeout exceeded when trying to connect")
    || error.message.includes("Connection terminated");
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === "23505";
}
