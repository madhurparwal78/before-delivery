import pg from "pg";
import { config } from "./config.js";
import { STARTING_CONTENT } from "./seed.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8, connectionTimeoutMillis: 3000 });
pool.on("error", () => undefined);

const SCHEMA_LOCK = 4173001;
export const ENQUIRY_LOCK = 4173002;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS content_edition (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  edition integer NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  position integer PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  content jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS statistics (
  position integer PRIMARY KEY,
  id text NOT NULL UNIQUE,
  content jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS enquiries (
  number integer PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  submission_id uuid NOT NULL UNIQUE,
  brief_token text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  project_type text NOT NULL,
  budget text NOT NULL,
  description text NOT NULL,
  mail text NOT NULL CHECK (mail IN ('sent', 'not_sent')),
  stored_at timestamptz NOT NULL DEFAULT now()
);`;

/** Applies the schema and stores the starting content when the database is empty; safe to run on every start. */
async function prepareDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
    const { rowCount } = await client.query("SELECT 1 FROM content_edition");
    if (rowCount === 0) await writeStartingContent(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Retries every 2 seconds until Postgres answers. */
export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await prepareDatabase();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

const STARTING_EDITION = 1;

/** Stores the starting content at the starting edition and returns that edition. */
export async function writeStartingContent(client: pg.PoolClient): Promise<number> {
  await client.query("DELETE FROM projects");
  await client.query("DELETE FROM statistics");
  await insertContent(client, STARTING_CONTENT.projects, STARTING_CONTENT.stats);
  await client.query(
    "INSERT INTO content_edition (singleton, edition) VALUES (true, $1) ON CONFLICT (singleton) DO UPDATE SET edition = $1",
    [STARTING_EDITION],
  );
  return STARTING_EDITION;
}

export async function insertContent(
  client: pg.PoolClient,
  projects: readonly { slug: string }[],
  stats: readonly { id: string }[],
): Promise<void> {
  for (const [position, project] of projects.entries()) {
    await client.query("INSERT INTO projects (position, slug, content) VALUES ($1, $2, $3)", [position, project.slug, JSON.stringify(project)]);
  }
  for (const [position, stat] of stats.entries()) {
    await client.query("INSERT INTO statistics (position, id, content) VALUES ($1, $2, $3)", [position, stat.id, JSON.stringify(stat)]);
  }
}

export async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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
