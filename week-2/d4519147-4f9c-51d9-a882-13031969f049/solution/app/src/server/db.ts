import pg from "pg";
import { config } from "./config.ts";

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
pool.on("error", () => {
  // An idle client lost its connection; the pool replaces it on the next checkout.
});

let ready = false;
export const isReady = () => ready;
export const markReady = () => {
  ready = true;
};

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

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await db.query<T>(sql, params);
  return result.rows[0];
}

/** A row the rules guarantee exists (a locked or just-written row); its absence is an unexpected failure. */
export async function oneRow<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = await one<T>(db, sql, params);
  if (!row) throw new Error("expected row is missing");
  return row;
}

export async function many<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
