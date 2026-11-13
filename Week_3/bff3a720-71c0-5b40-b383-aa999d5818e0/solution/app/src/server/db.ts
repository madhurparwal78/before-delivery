import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "./config";

pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

export interface Db {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
}

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });
pool.on("error", () => undefined);

export function newId(): string {
  return randomUUID();
}

export interface TxHandle extends Db {
  /** Run after COMMIT succeeds (events, mail attempts). */
  afterCommit(task: () => Promise<void>): void;
}

/** Run `work` in one transaction. A thrown error rolls back unless it is flagged `commit`. */
export async function transaction<T>(work: (db: TxHandle) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tasks: (() => Promise<void>)[] = [];
  const handle: TxHandle = {
    query: (text, params) => client.query(text, params),
    afterCommit: (task) => void tasks.push(task),
  };
  let outcome: { value: T } | { error: unknown };
  try {
    await client.query("BEGIN");
    outcome = { value: await work(handle) };
  } catch (error) {
    outcome = { error };
  }
  const keepWrites = "error" in outcome ? (outcome.error as { commit?: boolean } | null)?.commit === true : true;
  try {
    await client.query(keepWrites ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    client.release(true);
    throw error;
  }
  client.release();
  if (keepWrites) for (const task of tasks) await task().catch(() => undefined);
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

/** Take a transaction-level advisory lock keyed by text. */
export async function lockKey(db: Db, key: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}
