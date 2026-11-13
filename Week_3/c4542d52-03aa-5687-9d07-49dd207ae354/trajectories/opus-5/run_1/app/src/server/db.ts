import pg from "pg";
import { config } from "./config.js";

export type QueryParam = string | number | boolean | Date | null | string[] | bigint;

const INT8_OID = 20;
const DATE_OID = 1082;
pg.types.setTypeParser(INT8_OID, (value: string) => Number(value));
pg.types.setTypeParser(DATE_OID, (value: string) => value);

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

let registerReady = false;
let recovering = false;

pool.on("error", () => {
  registerReady = false;
  void recover();
});

export function isRegisterReady(): boolean {
  return registerReady;
}

async function recover(): Promise<void> {
  if (recovering) return;
  recovering = true;
  while (!registerReady) {
    try {
      await pool.query("select 1");
      registerReady = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  recovering = false;
}

export async function query<T extends pg.QueryResultRow>(text: string, params: QueryParam[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow>(text: string, params: QueryParam[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export interface Transaction {
  query<T extends pg.QueryResultRow>(text: string, params?: QueryParam[]): Promise<T[]>;
  queryOne<T extends pg.QueryResultRow>(text: string, params?: QueryParam[]): Promise<T | null>;
}

/** The register outside any transaction, for reads. */
export const db: Transaction = { query, queryOne };

export async function withTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Transaction = {
    async query<R extends pg.QueryResultRow>(text: string, params: QueryParam[] = []): Promise<R[]> {
      const result = await client.query<R>(text, params);
      return result.rows;
    },
    async queryOne<R extends pg.QueryResultRow>(text: string, params: QueryParam[] = []): Promise<R | null> {
      const result = await client.query<R>(text, params);
      return result.rows[0] ?? null;
    },
  };
  try {
    await client.query("begin");
    const value = await run(tx);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function connectWithRetry(onConnected: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await pool.query("select 1");
      await onConnected();
      registerReady = true;
      return;
    } catch (error) {
      registerReady = false;
      process.stdout.write(`register unavailable, retrying: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
