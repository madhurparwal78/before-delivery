// Versioned schema migrations from `migrations/*.sql`, each applied exactly once under a Postgres advisory lock
// shared by every instance that boots against the database, then the one-time seed (brief: Services, Postgres,
// Migrations; Seed data).
import { readFile, readdir } from "node:fs/promises";
import { now } from "./clock.js";
import { connect } from "./db.js";
import { log } from "./log.js";
import { seed } from "./seed.js";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);
const BOOT_LOCK = 4_173_001;

export async function migrateAndSeed(): Promise<void> {
  const client = await connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [BOOT_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL)`);
    const applied = new Set((await client.query<{ version: string }>(`SELECT version FROM schema_migrations`)).rows.map((row) => row.version));
    const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(await readFile(new URL(file, MIGRATIONS), "utf8"));
        await client.query(`INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)`, [version, new Date(now())]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      log("info", "migration applied", { event: "migration_applied", version });
    }
    const seeded = await client.query(`SELECT 1 FROM practice WHERE id = 1`);
    if (!seeded.rowCount) {
      await client.query("BEGIN");
      try {
        await seed(client, now());
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      log("info", "seed written", { event: "seed_written" });
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [BOOT_LOCK]).catch(() => undefined);
    client.release();
  }
}
