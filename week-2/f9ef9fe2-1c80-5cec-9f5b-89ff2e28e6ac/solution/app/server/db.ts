import pg from "pg";
import { config } from "./config.js";

// Kitchen dates stay plain YYYY-MM-DD strings; a JS Date would shift them by the server zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 30 });
pool.on("error", (error) => console.error(`PostgreSQL idle client error: ${error.name}`));

export type Client = pg.PoolClient;

export async function transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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

/** Serialises every claim on one kitchen date: holds, confirms, series and cancels. */
export async function lockKitchenDates(client: Client, kitchenId: string, dates: string[]): Promise<void> {
  for (const date of [...new Set(dates)].sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${kitchenId}:${date}`]);
  }
}

export async function audit(
  client: Client,
  actorId: string | null,
  entity: string,
  entityId: string,
  fromState: string | null,
  toState: string,
  at: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, entity, entity_id, from_state, to_state, at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, entity, entityId, fromState, toState, at],
  );
}
