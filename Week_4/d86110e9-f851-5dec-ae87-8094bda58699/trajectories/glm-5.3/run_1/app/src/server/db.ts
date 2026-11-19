import { Pool, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

export interface Db {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
  }
  return pool;
}

export const db: Db = {
  query: (text, values) => getPool().query(text, values),
};

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const DDL = readFileSync(join(here, "schema.sql"), "utf8");

export async function migrate(db: Db): Promise<void> {
  await db.query(DDL);
}
