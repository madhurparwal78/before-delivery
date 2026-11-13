// Postgres access: one pool, transactions, advisory locks, schema applied idempotently at serve.
import pg from "pg";
import { config } from "./config";

pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", () => undefined);

export type Queryable = Pick<pg.PoolClient, "query">;

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EPIPE"]);

export function isDatabaseDown(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? "";
  return CONNECTION_CODES.has(code) || code.startsWith("08") || code.startsWith("57P") || /Connection terminated|timeout exceeded when trying to connect/.test(error.message);
}

/** True for a Postgres unique-key violation, which a lost race on a name turns into the published name-taken refusal. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === "23505";
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

/** Holds a per-key advisory lock for the length of a transaction. */
export async function locked<T>(scope: string, key: number, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), $2)", [scope, key]);
    return work(client);
  });
}

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL,
  time_zone text NOT NULL DEFAULT 'UTC', current_space_id int
);
CREATE TABLE IF NOT EXISTS spaces (
  id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, seq bigint NOT NULL DEFAULT 0, case_seq int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  space_id int NOT NULL REFERENCES spaces(id), user_id int NOT NULL REFERENCES users(id), role text NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id int NOT NULL REFERENCES users(id), created_ms bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), name text NOT NULL, stream_pattern text NOT NULL,
  actions text[] NOT NULL, created_ms bigint NOT NULL, expires_ms bigint, revoked boolean NOT NULL DEFAULT false,
  last4 text NOT NULL, key_hash text UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS streams (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), name text NOT NULL,
  write_generation int NOT NULL DEFAULT 1, lifecycle jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (space_id, name)
);
CREATE TABLE IF NOT EXISTS generations (
  stream_id int NOT NULL REFERENCES streams(id), number int NOT NULL, phase text NOT NULL, created_ms bigint NOT NULL,
  rolled_over_ms bigint, min_ts bigint, max_ts bigint, segment_key text, segment_bytes bigint,
  archived_events int NOT NULL DEFAULT 0, archive_failed boolean NOT NULL DEFAULT false, delete_failed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (stream_id, number)
);
CREATE TABLE IF NOT EXISTS mappings (
  stream_id int NOT NULL, generation int NOT NULL, field text NOT NULL, type text NOT NULL, explicit boolean NOT NULL,
  PRIMARY KEY (stream_id, generation, field)
);
CREATE TABLE IF NOT EXISTS event_keys (
  stream_id int NOT NULL, ext_id text NOT NULL, generation int NOT NULL, PRIMARY KEY (stream_id, ext_id)
);
CREATE TABLE IF NOT EXISTS events (
  stream_id int NOT NULL, ext_id text NOT NULL, generation int NOT NULL, ts bigint NOT NULL, doc jsonb NOT NULL,
  pipeline text, ordinal bigserial NOT NULL, PRIMARY KEY (stream_id, ext_id)
);
CREATE INDEX IF NOT EXISTS events_by_ts ON events (stream_id, ts);
CREATE INDEX IF NOT EXISTS events_by_generation ON events (stream_id, generation);
CREATE TABLE IF NOT EXISTS postings (
  stream_id int NOT NULL, generation int NOT NULL, field text NOT NULL, term text NOT NULL, ext_id text NOT NULL,
  ts bigint NOT NULL, tf int NOT NULL, positions int[] NOT NULL
);
CREATE INDEX IF NOT EXISTS postings_by_term ON postings (stream_id, field, term, ts);
CREATE INDEX IF NOT EXISTS postings_by_generation ON postings (stream_id, generation);
CREATE TABLE IF NOT EXISTS field_lengths (
  stream_id int NOT NULL, generation int NOT NULL, field text NOT NULL, ext_id text NOT NULL, ts bigint NOT NULL, dl int NOT NULL
);
CREATE INDEX IF NOT EXISTS field_lengths_by_field ON field_lengths (stream_id, field, ts);
CREATE INDEX IF NOT EXISTS field_lengths_by_generation ON field_lengths (stream_id, generation);
CREATE TABLE IF NOT EXISTS failures (
  id bigserial PRIMARY KEY, stream_id int NOT NULL, reason text NOT NULL, raw text NOT NULL, at_ms bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS failures_by_stream ON failures (stream_id, at_ms DESC, id DESC);
CREATE TABLE IF NOT EXISTS uploads (
  id serial PRIMARY KEY, stream_id int NOT NULL, file text NOT NULL, bytes bigint NOT NULL, sha256 text NOT NULL,
  status text NOT NULL, total_lines int NOT NULL DEFAULT 0, done_lines int NOT NULL DEFAULT 0,
  created int NOT NULL DEFAULT 0, duplicates int NOT NULL DEFAULT 0, dropped int NOT NULL DEFAULT 0, failed int NOT NULL DEFAULT 0,
  created_ms bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS pipelines (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), name text NOT NULL, version int NOT NULL,
  processors jsonb NOT NULL, UNIQUE (space_id, name)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id text PRIMARY KEY, space_id int NOT NULL, stream_id int NOT NULL, request jsonb NOT NULL, total int NOT NULL,
  partial boolean NOT NULL, skipped int NOT NULL, ordinal_mark bigint NOT NULL, last_used_ms bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot_events (
  snapshot_id text NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, pos int NOT NULL, event jsonb NOT NULL,
  PRIMARY KEY (snapshot_id, pos)
);
CREATE TABLE IF NOT EXISTS saved_searches (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), name text NOT NULL, stream text NOT NULL,
  q text NOT NULL, filters jsonb NOT NULL, from_ts text NOT NULL, to_ts text NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), name text NOT NULL, stream text NOT NULL,
  filter jsonb, measure text NOT NULL, measure_field text, group_by text, window_ms bigint NOT NULL,
  comparison text NOT NULL, threshold double precision NOT NULL, frequency jsonb NOT NULL,
  last_check_ms bigint, last_check_failed boolean, UNIQUE (space_id, name)
);
CREATE TABLE IF NOT EXISTS rule_groups (
  rule_id int NOT NULL REFERENCES rules(id), name text NOT NULL, state text NOT NULL, since_ms bigint,
  streak int NOT NULL DEFAULT 0, change_flags jsonb NOT NULL DEFAULT '[]'::jsonb, snoozed_until_ms bigint,
  snooze_until_recovered boolean NOT NULL DEFAULT false, acknowledged_by text, last_action_ms bigint,
  held_window text, in_maintenance_window text, PRIMARY KEY (rule_id, name)
);
CREATE TABLE IF NOT EXISTS rule_history (
  id bigserial PRIMARY KEY, rule_id int NOT NULL REFERENCES rules(id), at_ms bigint NOT NULL, group_name text NOT NULL,
  from_state text NOT NULL, to_state text NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), name text NOT NULL, time_zone text NOT NULL,
  days text[] NOT NULL, start text NOT NULL, duration_ms bigint NOT NULL, rule_id int NOT NULL REFERENCES rules(id)
);
CREATE TABLE IF NOT EXISTS inbox_items (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), rule_id int NOT NULL REFERENCES rules(id),
  group_name text NOT NULL, text text NOT NULL, at_ms bigint NOT NULL, acknowledged_by text
);
CREATE TABLE IF NOT EXISTS cases (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), number int NOT NULL, title text NOT NULL,
  status text NOT NULL, created_ms bigint NOT NULL, UNIQUE (space_id, number)
);
CREATE TABLE IF NOT EXISTS case_items (
  id serial PRIMARY KEY, case_id int NOT NULL REFERENCES cases(id), kind text NOT NULL, rule_id int, group_name text,
  inbox_id int, trace_id text
);
CREATE TABLE IF NOT EXISTS traces (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), trace_id text NOT NULL, spans jsonb NOT NULL,
  created_ms bigint NOT NULL, UNIQUE (space_id, trace_id)
);
CREATE TABLE IF NOT EXISTS objectives (
  id serial PRIMARY KEY, space_id int NOT NULL REFERENCES spaces(id), service text NOT NULL, name text NOT NULL,
  stream text NOT NULL, target text NOT NULL, objective_window_ms bigint NOT NULL, bad jsonb NOT NULL, counts jsonb,
  UNIQUE (space_id, service), UNIQUE (space_id, name)
);
`;

export async function migrate(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('schema'), 1)");
    await client.query(SCHEMA);
  });
}
