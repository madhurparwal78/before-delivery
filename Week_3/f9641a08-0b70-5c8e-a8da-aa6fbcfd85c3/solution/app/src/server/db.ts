import pg from "pg";
import { config } from "./config";

// Numbers come back as numbers: counts (bigint) and dimensions (numeric) are small.
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });
pool.on("error", () => undefined);

export type Db = pg.PoolClient;
export type Queryable = Pick<pg.Pool, "query"> | pg.PoolClient;

interface PendingEvent {
  type: string;
  data: object;
  audience: "all" | "owner" | "staff";
  owner: string | null;
}

/** One transaction: its live events are written last, just before COMMIT, and its after-commit hooks run once it lands. */
export interface Unit {
  db: Db;
  events: PendingEvent[];
  afterCommit: (() => void)[];
}

/** Runs `work` in one transaction; any throw rolls everything back, events and hooks included. */
export async function unit<T>(work: (u: Unit) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  const u: Unit = { db, events: [], afterCommit: [] };
  try {
    await db.query("BEGIN");
    const result = await work(u);
    for (const event of u.events) {
      const { rows: [counter] } = await db.query<{ seq: number }>("UPDATE live_counter SET seq = seq + 1 WHERE id = 1 RETURNING seq");
      await db.query("INSERT INTO live_events (seq, type, data, audience, owner) VALUES ($1, $2, $3, $4, $5)", [
        counter?.seq,
        event.type,
        JSON.stringify(event.data),
        event.audience,
        event.owner,
      ]);
    }
    if (u.events.length > 0) await db.query("SELECT pg_notify('live', '')");
    await db.query("COMMIT");
    u.afterCommit.forEach((hook) => hook());
    return result;
  } catch (failure) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw failure;
  } finally {
    db.release();
  }
}

/** Queues a live event; it gets the next number in the shared sequence when the unit commits. */
export function emit(u: Unit, type: string, data: object, audience: PendingEvent["audience"], owner: string | null = null): void {
  u.events.push({ type, data, audience, owner });
}

export async function rows<T extends object>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T extends object>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export function isUniqueViolation(failure: unknown): boolean {
  return typeof failure === "object" && failure !== null && "code" in failure && failure.code === "23505";
}

/** Retries PostgreSQL for up to 60 seconds, then gives up. */
export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (failure) {
      if (Date.now() > deadline) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
