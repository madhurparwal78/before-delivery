import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 14, idleTimeoutMillis: 1500, connectionTimeoutMillis: 4000 });
pool.on("error", () => undefined);

export type Db = Pick<pg.PoolClient, "query">;

export const q = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T[]> => (await db.query<T>(sql, params)).rows;

export const one = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T | null> => (await q<T>(sql, params, db))[0] ?? null;

/** Runs `work` in one transaction; whatever it throws rolls back first. */
export async function tx<T>(work: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
}

/** A key for a transaction-scoped advisory lock: serialises work on one thing across copies. */
export const advisory = (c: Db, key: string): Promise<unknown> => c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);

export const isConnectionError = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string };
  return (
    typeof e.code === "string" &&
    (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EPIPE", "57P01", "57P02", "57P03", "08006", "08001", "08003", "08004", "3D000", "28000", "28P01"].includes(e.code) ||
      e.code.startsWith("08"))
  ) || /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/.test(e.message ?? "");
};
