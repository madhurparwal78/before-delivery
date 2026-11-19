import pg from "pg";
import { config } from "./config.js";
import { databaseUnavailable } from "./errors.js";

pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));
pg.types.setTypeParser(1700, (value: string) => Number(value));

export type Queryable = Pick<pg.PoolClient, "query">;
export type Row = Record<string, any>;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 16,
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 30000,
});
pool.on("error", () => undefined);
// a connection that drops while checked out must not take the process down
pool.on("connect", (client) => client.on("error", () => undefined));

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "3D000", "28P01", "28000"]);

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? "";
  if (CONNECTION_CODES.has(code) || code.startsWith("08") || code.startsWith("57P")) return true;
  return /Connection terminated|Client has encountered a connection error/i.test(error.message);
}

/** Whether the schema and seed are applied and the database is answering; the supervisor keeps it true. */
export const databaseState = { ready: false };

function asDatabaseOutage(error: unknown): unknown {
  if (!isConnectionError(error)) return error;
  databaseState.ready = false;
  return databaseUnavailable();
}

export async function rows<T extends Row = Row>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params as any[]);
  return result.rows as T[];
}

export async function one<T extends Row = Row>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function run(db: Queryable, sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query(sql, params as any[]);
  return result.rowCount ?? 0;
}

export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw asDatabaseOutage(error);
  }
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw asDatabaseOutage(error);
  } finally {
    client.release();
  }
}

/** Serialises transactions that touch the same named thing, across every instance sharing the database. */
export async function lockNamed(db: Queryable, name: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [name]);
}

export async function nextCode(db: Queryable, name: string): Promise<number> {
  const row = await one<{ next: number }>(db, "UPDATE code_seq SET next = next + 1 WHERE name = $1 RETURNING next - 1 AS next", [name]);
  if (!row) throw new Error(`unknown code sequence ${name}`);
  return row.next;
}

export async function opaqueId(db: Queryable, prefix: string): Promise<string> {
  const row = await one<{ n: number }>(db, "SELECT nextval('opaque_seq') AS n");
  return `${prefix}${String(row!.n).padStart(9, "0")}`;
}
