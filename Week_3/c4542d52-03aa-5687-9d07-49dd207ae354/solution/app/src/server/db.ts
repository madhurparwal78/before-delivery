import pg from "pg";
import { config } from "./config.js";
import { iso, now, sleep } from "./time.js";
import { schema } from "./schema.js";

pg.types.setTypeParser(20, (text) => Number.parseInt(text, 10));
pg.types.setTypeParser(1082, (text) => text);

type Event = { to: string | null; type: string; data: Record<string, unknown> };
export type Tx = {
  query<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  emit(event: Event): void;
  afterCommit(task: () => Promise<void> | void): void;
};

const SETUP_LOCK = 7000;
const SEQUENCE_LOCK = 7001;
export const POOL_LOCK = 7002;

let pool: pg.Pool | null = null;
export let databaseReady = false;

function open(): pg.Pool {
  const created = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });
  created.on("error", (error) => console.error("register database connection error:", error.message));
  return created;
}

export function database(): pg.Pool {
  if (!pool) throw new Error("the register database is not connected");
  return pool;
}

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await database().query<T>(sql, params);
  return result.rows;
}

/** True when a statement failed because a unique index refused a duplicate. */
export const isUniqueViolation = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "23505";

export type Queryable = { query: Tx["query"] };
export const direct: Queryable = { query };

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await database().connect();
  const events: Event[] = [];
  const tasks: Array<() => Promise<void> | void> = [];
  try {
    await client.query("BEGIN");
    const result = await work({
      query: async <R extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
        (await client.query<R>(sql, params)).rows,
      emit: (event) => events.push(event),
      afterCommit: (task) => tasks.push(task),
    });
    if (events.length > 0) {
      // One global lock, taken last, makes event sequence order equal commit order.
      await client.query("SELECT pg_advisory_xact_lock($1)", [SEQUENCE_LOCK]);
      const at = iso(now());
      await client.query(
        `INSERT INTO live_events (person_id, type, at, data)
         SELECT person_id, type, $1::timestamptz, data FROM json_to_recordset($2::json)
           AS e(person_id text, type text, data jsonb)`,
        [at, JSON.stringify(events.map((event) => ({ person_id: event.to, type: event.type, data: event.data })))],
      );
      await client.query("NOTIFY live_events");
    }
    await client.query("COMMIT");
    for (const task of tasks) await task();
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The one row a statement is certain to return (an insert with RETURNING, a key that was just checked). */
export function only<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("the register returned no row where one was certain");
  return row;
}

export async function nextId(tx: Tx, sequence: string, prefix: string, width: number): Promise<string> {
  const rows = await tx.query<{ n: number }>(`SELECT nextval('${sequence}') AS n`);
  return `${prefix}${String(rows[0]?.n ?? 0).padStart(width, "0")}`;
}

/** Connects (retrying every 2 seconds), then applies the schema and the seed once. */
export async function connectDatabase(seed: (tx: Tx) => Promise<void>): Promise<void> {
  for (;;) {
    try {
      pool = open();
      await pool.query("SELECT 1");
      const setup = await pool.connect();
      try {
        await setup.query("SELECT pg_advisory_lock($1)", [SETUP_LOCK]);
        await setup.query(schema);
        await setup.query("SELECT pg_advisory_unlock($1)", [SETUP_LOCK]);
      } finally {
        setup.release();
      }
      await seedWhenEmpty(seed);
      databaseReady = true;
      return;
    } catch (error) {
      console.error("register database not ready, retrying in 2 seconds:", error instanceof Error ? error.message : error);
      const stale = pool;
      pool = null;
      await stale?.end().catch((closing: unknown) => console.error("closing the register pool failed:", closing));
      await sleep(2000);
    }
  }
}

async function seedWhenEmpty(seed: (tx: Tx) => Promise<void>): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [SETUP_LOCK]);
    const rows = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM people");
    if ((rows[0]?.n ?? 0) === 0) await seed(tx);
  });
}
