// Postgres access: one pool from DATABASE_URL, a transaction helper, and the mapping of an
// unreachable database to 503 service_unavailable.
import pg from "pg";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 40,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 30_000,
});
pool.on("error", () => undefined);

export type Db = pg.Pool | pg.PoolClient;
type Row = Record<string, unknown>;

let ready = false;
export function markReady(): void {
  ready = true;
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE",
  "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006"]);

export function isDatabaseDown(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return (code !== undefined && CONNECTION_CODES.has(code)) || /Connection terminated|timeout exceeded when trying to connect/i.test(error.message);
}

export function requireDatabase(): void {
  if (!ready) throw new ApiError("service_unavailable");
}

export async function query<T = Row>(db: Db, text: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.query(text, values);
  return result.rows as T[];
}

export async function one<T = Row>(db: Db, text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(db, text, values))[0];
}

// For statements that always return a row: INSERT … RETURNING, or UPDATE … RETURNING of a row
// already locked FOR UPDATE in the same transaction.
export async function row<T = Row>(db: Db, text: string, values: unknown[] = []): Promise<T> {
  const found = (await query<T>(db, text, values))[0];
  if (found === undefined) throw new Error("expected a row");
  return found;
}

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

// Serialises every change to one object key (conditional writes, deletes, restores, expiry).
export async function lockKey(client: pg.PoolClient, bucketId: number, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 7))", [`${bucketId}:${key}`]);
}
