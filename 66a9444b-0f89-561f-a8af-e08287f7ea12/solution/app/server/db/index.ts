// Connection pool and transactions over the wire client.
import { config } from "../config.ts";
import { Connection, parseDatabaseUrl, type QueryResult, type Row, type SqlValue } from "./pgwire.ts";

export type { Row, SqlValue } from "./pgwire.ts";

const options = parseDatabaseUrl(config.databaseUrl);
const MAX_CONNECTIONS = 24;

const idle: Connection[] = [];
const waiters: ((connection: Connection) => void)[] = [];
let open = 0;

async function acquire(): Promise<Connection> {
  while (idle.length) {
    const connection = idle.pop()!;
    if (!connection.closed) return connection;
    open--;
  }
  if (open < MAX_CONNECTIONS) {
    open++;
    const connection = new Connection(options);
    try {
      await connection.open(5000);
      return connection;
    } catch (error) {
      open--;
      throw error;
    }
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release(connection: Connection): void {
  if (connection.closed) {
    open--;
    const waiter = waiters.shift();
    if (waiter) acquire().then(waiter, () => waiters.unshift(waiter));
    return;
  }
  const waiter = waiters.shift();
  if (waiter) waiter(connection);
  else idle.push(connection);
}

export type Db = {
  query<T extends Row = Row>(text: string, params?: readonly SqlValue[]): Promise<QueryResult<T>>;
  one<T extends Row = Row>(text: string, params?: readonly SqlValue[]): Promise<T | null>;
  all<T extends Row = Row>(text: string, params?: readonly SqlValue[]): Promise<T[]>;
};

function wrap(run: <T extends Row>(text: string, params: readonly SqlValue[]) => Promise<QueryResult<T>>): Db {
  return {
    query: (text, params = []) => run(text, params),
    one: async (text, params = []) => (await run(text, params)).rows[0] ?? null,
    all: async (text, params = []) => (await run(text, params)).rows,
  } as Db;
}

export const db: Db = wrap(async (text, params) => {
  const connection = await acquire();
  try {
    return await connection.query(text, params);
  } finally {
    release(connection);
  }
});

/** Runs `work` inside one transaction on one connection; rolls back when it throws. */
export async function transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  const connection = await acquire();
  try {
    await connection.query("BEGIN");
    const result = await work(wrap((text, params) => connection.query(text, params)));
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    if (!connection.closed) await connection.query("ROLLBACK").catch(() => connection.close());
    throw error;
  } finally {
    release(connection);
  }
}

/** Holds one connection for the duration of `work` (session-level advisory locks need this). */
export async function withConnection<T>(work: (conn: Db) => Promise<T>): Promise<T> {
  const connection = await acquire();
  try {
    return await work(wrap((text, params) => connection.query(text, params)));
  } finally {
    release(connection);
  }
}

/** Runs a multi-statement script while holding a session advisory lock, so instances booting together take turns. */
export async function runScriptLocked(lockName: string, sql: string): Promise<void> {
  const connection = await acquire();
  try {
    await connection.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    try {
      await connection.simple(sql);
    } finally {
      await connection.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
    }
  } finally {
    release(connection);
  }
}

export async function databaseUp(): Promise<boolean> {
  try {
    await db.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
