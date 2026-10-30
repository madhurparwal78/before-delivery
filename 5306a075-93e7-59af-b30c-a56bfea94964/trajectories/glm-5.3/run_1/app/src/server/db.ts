import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Pool, type PoolClient } from "pg";

const thisDir = dirname(fileURLToPath(import.meta.url));

export interface Migration {
  name: string;
  sql: string;
}

/** The schema is applied on every start, without duplication. */
export const MIGRATIONS: Migration[] = [
  {
    name: "001-core",
    sql: readFileSync(join(thisDir, "migrations/001-core.sql"), "utf-8"),
  },
];

interface SchemaRow {
  migration_name: string;
}

const TABLE_INIT = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query(TABLE_INIT);
  for (const m of MIGRATIONS) {
    await withTransaction(pool, async (client) => {
      const seen = await client.query<SchemaRow>(
        "SELECT migration_name FROM schema_migrations WHERE migration_name = $1",
        [m.name],
      );
      if (seen.rowCount !== 0) return;
      await client.query(m.sql);
      await client.query(
        "INSERT INTO schema_migrations (migration_name) VALUES ($1)",
        [m.name],
      );
    });
  }
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already unusable.
    }
    client.release();
    throw err;
  } finally {
    client.release();
  }
}
