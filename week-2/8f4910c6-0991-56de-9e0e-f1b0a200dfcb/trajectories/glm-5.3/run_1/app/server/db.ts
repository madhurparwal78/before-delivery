import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query(text, params as never[]);
  return result.rows as T[];
}

export async function one<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tx: Tx = {
      async query<R extends QueryResultRow>(text: string, params: unknown[] = []): Promise<R[]> {
        const res = await client.query(text, params as never[]);
        return res.rows as R[];
      },
      async one<R extends QueryResultRow>(text: string, params: unknown[] = []): Promise<R | null> {
        const rows = await this.query<R>(text, params);
        return rows[0] ?? null;
      },
    };
    const out = await fn(tx);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface Tx {
  query<R extends QueryResultRow>(text: string, params?: unknown[]): Promise<R[]>;
  one<R extends QueryResultRow>(text: string, params?: unknown[]): Promise<R | null>;
}

/** Reads rows through either the pool or an open transaction. */
export interface Reader {
  query<R extends QueryResultRow>(text: string, params?: unknown[]): Promise<R[]>;
  one<R extends QueryResultRow>(text: string, params?: unknown[]): Promise<R | null>;
}

export function poolReader(): Reader {
  return {
    query: <R extends QueryResultRow>(text: string, params: unknown[] = []) => query<R>(text, params),
    one: <R extends QueryResultRow>(text: string, params: unknown[] = []) => one<R>(text, params),
  };
}

import { config } from "./config.js";
