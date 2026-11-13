import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

export async function one<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const r = await query<T>(text, params);
  return r.rows[0] ?? null;
}

export async function all<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await query<T>(text, params);
  return r.rows;
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx: Tx = {
      async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
        return client.query<T>(text, params as never[]);
      },
      async one<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
        const r = await client.query<T>(text, params as never[]);
        return r.rows[0] ?? null;
      },
      async all<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
        const r = await client.query<T>(text, params as never[]);
        return r.rows;
      },
    };
    try {
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } finally {
    client.release();
  }
}

export interface Tx {
  query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  one<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>;
  all<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
}
