import { pool } from "./db.js";
import { SCHEMA } from "./schema.js";
import { seed } from "./seed.js";

const MIGRATION_LOCK = 727_301;

/** Apply the schema and the seed under one advisory lock so concurrent starts agree. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(SCHEMA);
    await seed(client);
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    client.release();
  }
}
