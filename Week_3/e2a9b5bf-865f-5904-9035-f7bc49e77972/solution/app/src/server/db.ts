import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "./config";

pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, idleTimeoutMillis: 30_000 });
pool.on("error", () => undefined);

/** Runs `work` in a transaction. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

/** Serialises every write of one account, across devices and app instances. */
export async function lockAccount(client: pg.PoolClient, accountId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [accountId]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const newId = (): string => randomUUID();

/** A stable id derived from a name, so seeding twice changes nothing. */
export function idFrom(name: string): string {
  const h = createHash("sha1").update(`lowlamp:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function canReachDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
