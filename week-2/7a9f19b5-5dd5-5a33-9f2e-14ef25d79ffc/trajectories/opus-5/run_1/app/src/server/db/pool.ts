import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { loadConfig } from "../config.js";

const config = loadConfig();

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Runs `work` in a transaction, rolling back on any thrown error. */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rows<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function row<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const result = await rows<T>(client, sql, params);
  return result[0] ?? null;
}
