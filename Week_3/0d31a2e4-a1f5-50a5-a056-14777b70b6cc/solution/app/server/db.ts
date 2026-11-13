// PostgreSQL access: the pool, transactions and the cross-process event channel.
import pg from "pg";
import { SCHEMA } from "./schema.js";

pg.types.setTypeParser(20, (value: string) => Number(value));

export type Queryable = pg.Pool | pg.PoolClient;
export type Row = Record<string, unknown>;

const EVENT_CHANNEL = "pc_events";
const SCHEMA_LOCK = 72_011;
const RETRY_MS = 2000;

let pool: pg.Pool | null = null;
let ready = false;

export function isReady(): boolean {
  return ready;
}

export function db(): pg.Pool {
  if (pool === null) throw new Error("database not connected");
  return pool;
}

// Rows come back typed as the caller's row shape; the SQL text is what guarantees the columns.
export async function query<T extends object = Row>(text: string, values: unknown[] = [], on: Queryable = db()): Promise<T[]> {
  const result = await on.query(text, values);
  return result.rows as T[];
}

export async function one<T extends object = Row>(text: string, values: unknown[] = [], on: Queryable = db()): Promise<T | undefined> {
  const rows = await query<T>(text, values, on);
  return rows[0];
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const LOCK = { signup: 1, friendPair: 2, seating: 3, links: 4, sender: 5 } as const;

// Serialises work on one key across every server process sharing the database, until the transaction ends.
export async function lockKey(client: pg.PoolClient, space: number, key: number): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [space, key]);
}

export type ServerEvent =
  | { kind: "party"; partyId: number }
  | { kind: "invites"; userId: number }
  | { kind: "friends"; userId: number }
  | { kind: "lobby"; lobbyId: number }
  | { kind: "chat"; messageId: number }
  | { kind: "forfeit"; matchId: number; userId: number };

// Queued with the transaction and delivered to every process once it commits.
export async function emit(on: Queryable, event: ServerEvent): Promise<void> {
  await on.query("SELECT pg_notify($1, $2)", [EVENT_CHANNEL, JSON.stringify(event)]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connect(url: string, prepare: (client: pg.PoolClient) => Promise<void>,
  onEvent: (event: ServerEvent) => void): Promise<void> {
  for (;;) {
    const candidate = new pg.Pool({ connectionString: url, max: 20 });
    candidate.on("error", () => undefined);
    try {
      const client = await candidate.connect();
      try {
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
        await client.query(SCHEMA);
        await prepare(client);
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
        client.release();
      }
      const listener = await candidate.connect();
      listener.on("notification", (message) => {
        if (message.channel === EVENT_CHANNEL && message.payload !== undefined) {
          onEvent(JSON.parse(message.payload) as ServerEvent);
        }
      });
      await listener.query(`LISTEN ${EVENT_CHANNEL}`);
      pool = candidate;
      ready = true;
      return;
    } catch (error) {
      console.error(`database not ready (${error instanceof Error ? error.message : "unknown error"}); retrying`);
      await candidate.end();
      await sleep(RETRY_MS);
    }
  }
}
