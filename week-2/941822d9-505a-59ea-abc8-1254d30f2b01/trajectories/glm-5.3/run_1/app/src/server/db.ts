import pg from "pg";
import { config } from "./config.ts";

const { Pool } = pg;
type PoolClient = pg.PoolClient;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function withSerializable<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((err as { code?: string }).code === "40001") {
      return withSerializable(fn);
    }
    throw err;
  } finally {
    client.release();
  }
}

export const query = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> => pool.query(sql, params) as Promise<{ rows: T[]; rowCount: number | null }>;
