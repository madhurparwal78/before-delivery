import { pool } from "./db.js";
import { SCHEMA } from "./schema.js";
import { seed } from "./seed.js";

const SETUP_LOCK = 4_173_001;

/** Applies the schema and seed under an advisory lock, so processes starting together set up once. */
export async function migrateAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SETUP_LOCK]);
    try {
      await client.query(SCHEMA);
      await seed(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SETUP_LOCK]);
    }
  } finally {
    client.release();
  }
}
