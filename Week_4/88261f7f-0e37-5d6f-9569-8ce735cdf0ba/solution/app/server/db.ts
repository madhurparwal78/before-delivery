import pg from "pg";
import { config } from "./config";

pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(1700, (value) => value);

let pool: pg.Pool | null = null;

export type Queryable = pg.Pool | pg.PoolClient;
export type Row = pg.QueryResultRow;

export function database(): pg.Pool {
  if (!pool || pool.options.connectionString !== config.databaseUrl) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000 });
    pool.on("error", () => undefined);
  }
  return pool;
}

export async function rows<T extends Row>(from: Queryable, sql: string, values: unknown[] = []): Promise<T[]> {
  return (await from.query<T>(sql, values)).rows;
}

export async function one<T extends Row>(from: Queryable, sql: string, values: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(from, sql, values))[0];
}

/** The row an `INSERT ... RETURNING` or a foreign-key lookup is certain to produce. */
export async function inserted<T extends Row>(from: Queryable, sql: string, values: unknown[] = []): Promise<T> {
  return (await rows<T>(from, sql, values))[0] as T;
}

export async function run(from: Queryable, sql: string, values: unknown[] = []): Promise<number> {
  return (await from.query(sql, values)).rowCount ?? 0;
}

/** One database transaction; any throw rolls everything back. */
export async function atomic<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (failure) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw failure;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(failure: unknown, constraint?: string): boolean {
  if (typeof failure !== "object" || failure === null) return false;
  const { code, constraint: name } = failure as { code?: string; constraint?: string };
  return code === "23505" && (constraint === undefined || name === constraint);
}
