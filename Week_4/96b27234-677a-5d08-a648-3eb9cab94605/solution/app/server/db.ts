import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

// pg returns timestamptz as Date and bigint as string; numbers we store are small.
pg.types.setTypeParser(20, (value) => Number(value));

const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000 });
pool.on("error", () => undefined);

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = Record<string, never>>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  const result = await db.query<T, unknown[]>(sql, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (id text PRIMARY KEY, clock_now timestamptz);
INSERT INTO worlds (id) VALUES ('default') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION world_now(wid text) RETURNS timestamptz LANGUAGE sql STABLE AS
  $$ SELECT coalesce((SELECT clock_now FROM worlds WHERE id = wid), now()) $$;
CREATE SEQUENCE IF NOT EXISTS join_seq;
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, world_id text NOT NULL REFERENCES worlds(id), email text NOT NULL UNIQUE,
  password_hash text NOT NULL, display_name text NOT NULL, time_zone text NOT NULL,
  site_role text NOT NULL DEFAULT 'member', avatar_id text, hide_above text,
  confirmed boolean NOT NULL DEFAULT false, suspended boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_tokens (token_hash text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS confirmations (token text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS friendships (a text NOT NULL REFERENCES people(id) ON DELETE CASCADE, b text NOT NULL REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS blocks (from_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, to_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (from_id, to_id));
CREATE TABLE IF NOT EXISTS mutes (from_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, to_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (from_id, to_id));
CREATE TABLE IF NOT EXISTS friend_invites (
  id text PRIMARY KEY, token text NOT NULL UNIQUE, from_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  email text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY, world_id text NOT NULL REFERENCES worlds(id), owner_id text NOT NULL REFERENCES people(id),
  kind text NOT NULL, name text NOT NULL, current_version int, next_version int NOT NULL DEFAULT 1, removed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS asset_versions (
  asset_id text NOT NULL REFERENCES assets(id), version int NOT NULL, status text NOT NULL, rank text NOT NULL,
  worst_measure text NOT NULL, measures jsonb NOT NULL, measure_ranks jsonb NOT NULL, layout jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (asset_id, version)
);
CREATE TABLE IF NOT EXISTS communities (id text PRIMARY KEY, world_id text NOT NULL REFERENCES worlds(id), name text NOT NULL, time_zone text NOT NULL);
CREATE TABLE IF NOT EXISTS community_members (
  community_id text NOT NULL REFERENCES communities(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role text NOT NULL, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (community_id, person_id)
);
CREATE TABLE IF NOT EXISTS gatherings (
  id text PRIMARY KEY, community_id text NOT NULL REFERENCES communities(id) ON DELETE CASCADE, title text NOT NULL,
  starts_local text NOT NULL, duration_minutes int NOT NULL, recurrence text NOT NULL, attend_limit int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendees (gathering_id text NOT NULL REFERENCES gatherings(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (gathering_id, person_id));
CREATE TABLE IF NOT EXISTS reminders (gathering_id text NOT NULL REFERENCES gatherings(id) ON DELETE CASCADE, starts_at timestamptz NOT NULL, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (gathering_id, starts_at, person_id));
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, world_id text NOT NULL REFERENCES worlds(id), room_id text NOT NULL REFERENCES assets(id),
  host_id text NOT NULL REFERENCES people(id), visibility text NOT NULL, capacity int NOT NULL,
  community_id text REFERENCES communities(id), status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS session_members (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  joined_seq bigint NOT NULL, room_version int NOT NULL, gone boolean NOT NULL DEFAULT false, PRIMARY KEY (session_id, person_id)
);
CREATE TABLE IF NOT EXISTS session_invitees (session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (session_id, person_id));
CREATE TABLE IF NOT EXISTS session_bans (session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (session_id, person_id));
CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, from_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  text text NOT NULL, sent_at timestamptz NOT NULL, recipients text[] NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, target_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL, closes_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'open', eligible int NOT NULL, needed int NOT NULL
);
CREATE TABLE IF NOT EXISTS vote_eligible (vote_id text NOT NULL REFERENCES votes(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (vote_id, person_id));
CREATE TABLE IF NOT EXISTS ballots (vote_id text NOT NULL REFERENCES votes(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, choice text NOT NULL, PRIMARY KEY (vote_id, person_id));
CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY, world_id text NOT NULL REFERENCES worlds(id), person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, category text NOT NULL, details text NOT NULL,
  state text NOT NULL DEFAULT 'open', action text, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS warnings (id bigserial PRIMARY KEY, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, delivered boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS drops (person_id text PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE, due_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY, to_addr text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, next_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (next_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
`;

let ready = false;
export const databaseReady = (): boolean => ready;

/** Applies the schema once Postgres answers; the lock makes several instances starting together safe. */
export async function prepareDatabase(): Promise<void> {
  for (;;) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query("SELECT pg_advisory_lock(727001)");
      try {
        await client.query(SCHEMA);
      } finally {
        await client.query("SELECT pg_advisory_unlock(727001)");
      }
      ready = true;
      return;
    } catch (error) {
      console.error("waiting for Postgres:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      client?.release();
    }
  }
}
