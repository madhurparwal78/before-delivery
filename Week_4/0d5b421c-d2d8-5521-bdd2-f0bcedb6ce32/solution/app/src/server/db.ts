import pg from "pg";
import { config } from "./config.js";
import { hashPassword } from "./passwords.js";
import { SCHEMA } from "./schema.js";
import { SEED_HOST, SEED_PAIRS, SEED_ROOMS, SEED_RULES } from "./seed.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 8,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
});

// A connection the server drops (a restart, a terminated backend) fails its query; it never brings the process down.
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

/** Rows of a parameterised statement, typed by the caller. */
export async function rows<Row extends pg.QueryResultRow>(
  db: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> {
  return (await db.query<Row>(sql, params)).rows;
}

export async function transaction<Result>(work: (client: pg.PoolClient) => Promise<Result>): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Key locks wait on their own connections, so waiting never starves the work the holder needs `pool` for. */
const lockPool = new pg.Pool({ connectionString: config.databaseUrl, max: 8, idleTimeoutMillis: 5_000 });
lockPool.on("error", () => undefined);
lockPool.on("connect", (client) => client.on("error", () => undefined));

/** Runs the work while holding a Postgres session lock on the name, so it is one at a time across every instance. */
export async function withSharedLock<Result>(name: string, work: () => Promise<Result>): Promise<Result> {
  const client = await lockPool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [name]);
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [name]);
    }
  } finally {
    client.release();
  }
}

export const EXCLUSION_VIOLATION = "23P01";
export const UNIQUE_VIOLATION = "23505";

export function isPgError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

const BOOT_LOCK = 41_001;
const BOOT_WAIT_MS = 60_000;

/** Waits up to 60 s for Postgres; the caller exits non-zero when it never answers. */
export async function waitForPostgres(): Promise<void> {
  const deadline = Date.now() + BOOT_WAIT_MS;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

export async function migrateAndSeed(): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [BOOT_LOCK]);
    await client.query(SCHEMA);
    for (const [roomIndex, room] of SEED_ROOMS.entries()) {
      await client.query("INSERT INTO rooms (room_id, name, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
        room.roomId,
        room.name,
        roomIndex,
      ]);
    }
    let position = 0;
    for (const room of SEED_ROOMS) {
      for (const [tableId, minSeats, maxSeats] of room.tables) {
        await client.query(
          "INSERT INTO tables (table_id, room_id, min_seats, max_seats, position) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
          [tableId, room.roomId, minSeats, maxSeats, position++],
        );
      }
    }
    for (const pair of SEED_PAIRS) {
      await client.query(
        "INSERT INTO joinable_pairs (pair_id, table_a, table_b, min_seats, max_seats) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [pair.pairId, pair.tableA, pair.tableB, pair.minSeats, pair.maxSeats],
      );
    }
    await client.query("INSERT INTO published_rules (id, body) VALUES (1, $1) ON CONFLICT DO NOTHING", [SEED_RULES]);
    await client.query(
      "INSERT INTO host_accounts (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [SEED_HOST.email, SEED_HOST.name, hashPassword(SEED_HOST.password)],
    );
  });
}
