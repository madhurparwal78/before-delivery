/** The PostgreSQL pool, transactions, and the database availability state. */
import pg from "pg";
import { MAX_DATABASE_CONNECTIONS } from "../shared/rules.js";
import { config } from "./config.js";

pg.types.setTypeParser(20, (value: string) => Number(value));
pg.types.setTypeParser(1082, (value: string) => value);

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: MAX_DATABASE_CONNECTIONS,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 4_000,
  query_timeout: 30_000,
});
pool.on("error", () => {
  databaseState.reachable = false;
});

/** Whether the database answered the last time we asked, and whether schema and seed are in place. */
export const databaseState = { reachable: false, ready: false };

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"]);

export class DatabaseUnavailable extends Error {}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? "";
  return (
    CONNECTION_CODES.has(code) ||
    code.startsWith("08") ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    /Connection terminated|connection timeout|Client has encountered a connection error|timeout exceeded when trying to connect|ECONNREFUSED/i.test(error.message)
  );
}

export interface Tx {
  query<R extends pg.QueryResultRow = Record<string, any>>(sql: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
  /** Runs after the transaction commits (live event delivery). */
  afterCommit(action: () => void): void;
}

const RETRYABLE = new Set(["40001", "40P01"]);

async function inClient<T>(begin: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      if (isConnectionError(error)) {
        databaseState.reachable = false;
        throw new DatabaseUnavailable();
      }
      throw error;
    }
    const hooks: Array<() => void> = [];
    const tx: Tx = {
      query: (sql, params) => client.query(sql, params as unknown[]),
      afterCommit: (action) => {
        hooks.push(action);
      },
    };
    let broken = false;
    try {
      await client.query(begin);
      const result = await work(tx);
      await client.query("COMMIT");
      for (const hook of hooks) hook();
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      const code = (error as { code?: string }).code ?? "";
      if (RETRYABLE.has(code) && attempt < 4) continue;
      if (isConnectionError(error)) {
        databaseState.reachable = false;
        throw new DatabaseUnavailable();
      }
      throw error;
    } finally {
      client.release(broken || undefined);
    }
  }
}

/** A read-write transaction; retried on deadlock or serialisation failure. */
export function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return inClient("BEGIN", work);
}

/** One consistent database snapshot for reads. */
export function snapshotRead<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return inClient("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", work);
}

export async function query<R extends pg.QueryResultRow = Record<string, any>>(sql: string, params?: unknown[]): Promise<pg.QueryResult<R>> {
  try {
    return await pool.query<R>(sql, params as unknown[]);
  } catch (error) {
    if (isConnectionError(error)) {
      databaseState.reachable = false;
      throw new DatabaseUnavailable();
    }
    throw error;
  }
}

/** Asks the database a trivial question; records whether it answered. */
export async function ping(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    databaseState.reachable = true;
    return true;
  } catch {
    databaseState.reachable = false;
    return false;
  }
}

export function isUniqueViolation(error: unknown, constraintHint?: string): boolean {
  const failure = error as { code?: string; constraint?: string };
  return failure.code === "23505" && (constraintHint === undefined || (failure.constraint ?? "").includes(constraintHint));
}
