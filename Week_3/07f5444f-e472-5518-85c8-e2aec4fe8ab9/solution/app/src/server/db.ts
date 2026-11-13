// Postgres: the system of record. The schema is applied idempotently on every start.

import pg from "pg";
import { config } from "./config.js";

export type Db = pg.Pool | pg.PoolClient;

// Timestamps come back as epoch milliseconds (instants); the domain code formats them in London time.
const parseTimestamp = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value) => (parseTimestamp(value) as Date).getTime());
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres idle client error", error.message));

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

/** Postgres error code of a failed statement, if it was one. */
export function pgCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  passcode_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('principal_librarian', 'assistant_librarian', 'section_principal', 'player')),
  chair_key text,
  chair_number integer,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people (id),
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogue_works (
  id text PRIMARY KEY,
  title text NOT NULL,
  composer text NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogue_bar_segments (
  catalogue_work_id text NOT NULL REFERENCES catalogue_works (id),
  from_bar integer NOT NULL,
  to_bar integer NOT NULL,
  bar_ms integer NOT NULL,
  PRIMARY KEY (catalogue_work_id, from_bar)
);

CREATE TABLE IF NOT EXISTS catalogue_rehearsal_letters (
  catalogue_work_id text NOT NULL REFERENCES catalogue_works (id),
  letter text NOT NULL,
  bar integer NOT NULL,
  PRIMARY KEY (catalogue_work_id, letter)
);

CREATE TABLE IF NOT EXISTS catalogue_parts (
  catalogue_work_id text NOT NULL REFERENCES catalogue_works (id),
  chair_key text NOT NULL,
  name text NOT NULL,
  bars_from integer NOT NULL,
  bars_to integer NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (catalogue_work_id, chair_key)
);

CREATE TABLE IF NOT EXISTS programmes (
  id text PRIMARY KEY,
  number integer NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'in_preparation', 'published', 'in_performance', 'closed')),
  first_rehearsal timestamptz NOT NULL,
  violin_1 integer NOT NULL,
  violin_2 integer NOT NULL,
  viola integer NOT NULL,
  cello integer NOT NULL,
  bass integer NOT NULL
);

CREATE TABLE IF NOT EXISTS performances (
  programme_id text NOT NULL REFERENCES programmes (id),
  performs_at timestamptz NOT NULL,
  PRIMARY KEY (programme_id, performs_at)
);

CREATE TABLE IF NOT EXISTS works (
  id text PRIMARY KEY,
  programme_id text NOT NULL REFERENCES programmes (id),
  catalogue_work_id text NOT NULL REFERENCES catalogue_works (id),
  title text NOT NULL,
  composer text NOT NULL,
  position integer NOT NULL,
  UNIQUE (programme_id, catalogue_work_id)
);

CREATE TABLE IF NOT EXISTS bar_segments (
  work_id text NOT NULL REFERENCES works (id),
  from_bar integer NOT NULL,
  to_bar integer NOT NULL,
  bar_ms integer NOT NULL,
  PRIMARY KEY (work_id, from_bar)
);

CREATE TABLE IF NOT EXISTS rehearsal_letters (
  work_id text NOT NULL REFERENCES works (id),
  letter text NOT NULL,
  bar integer NOT NULL,
  PRIMARY KEY (work_id, letter)
);

CREATE TABLE IF NOT EXISTS parts (
  id text PRIMARY KEY,
  work_id text NOT NULL REFERENCES works (id),
  chair_key text NOT NULL,
  name text NOT NULL,
  bars_from integer NOT NULL,
  bars_to integer NOT NULL,
  position integer NOT NULL,
  copies_on_hand integer NOT NULL DEFAULT 0 CHECK (copies_on_hand BETWEEN 0 AND 99),
  UNIQUE (work_id, chair_key)
);

CREATE TABLE IF NOT EXISTS cuts (
  id text PRIMARY KEY,
  work_id text NOT NULL REFERENCES works (id),
  from_bar integer NOT NULL,
  to_bar integer NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (from_bar <= to_bar),
  CONSTRAINT one_cut_per_bar EXCLUDE USING gist (work_id WITH =, int4range(from_bar, to_bar, '[]') WITH &&)
);

CREATE TABLE IF NOT EXISTS marks (
  part_id text NOT NULL REFERENCES parts (id),
  cut_id text NOT NULL REFERENCES cuts (id) ON DELETE CASCADE,
  marked_by text NOT NULL REFERENCES people (id),
  marked_at timestamptz NOT NULL,
  PRIMARY KEY (part_id, cut_id)
);

CREATE TABLE IF NOT EXISTS scans (
  id text PRIMARY KEY,
  part_id text NOT NULL REFERENCES parts (id),
  kind text NOT NULL CHECK (kind IN ('marked_part', 'bowing_master')),
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL UNIQUE,
  filed_at timestamptz NOT NULL,
  uploaded_by text NOT NULL REFERENCES people (id)
);

CREATE TABLE IF NOT EXISTS scan_upload_keys (
  person_id text NOT NULL REFERENCES people (id),
  idempotency_key text NOT NULL,
  part_id text NOT NULL,
  kind text NOT NULL,
  file_name text NOT NULL,
  sha256 text NOT NULL,
  response jsonb,
  PRIMARY KEY (person_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS publish_keys (
  idempotency_key text PRIMARY KEY,
  programme_id text NOT NULL REFERENCES programmes (id),
  response jsonb
);

CREATE TABLE IF NOT EXISTS notices (
  programme_id text NOT NULL REFERENCES programmes (id),
  player_id text NOT NULL REFERENCES people (id),
  status text NOT NULL CHECK (status IN ('queued', 'sent')),
  sent_at timestamptz,
  claimed_until timestamptz,
  PRIMARY KEY (programme_id, player_id)
);

CREATE TABLE IF NOT EXISTS rental_sets (
  id text PRIMARY KEY,
  work_id text NOT NULL REFERENCES works (id),
  publisher text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'received', 'in_use', 'returned', 'checked_in')),
  returned_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS rental_sets_one_open_per_work ON rental_sets (work_id) WHERE status <> 'checked_in';

CREATE TABLE IF NOT EXISTS slip_lines (
  rental_set_id text NOT NULL REFERENCES rental_sets (id),
  part_id text NOT NULL REFERENCES parts (id),
  copies integer NOT NULL CHECK (copies BETWEEN 1 AND 99),
  checked_in integer NOT NULL DEFAULT 0,
  CHECK (checked_in BETWEEN 0 AND copies),
  PRIMARY KEY (rental_set_id, part_id)
);

CREATE TABLE IF NOT EXISTS reminders (
  rental_set_id text NOT NULL REFERENCES rental_sets (id),
  assistant_id text NOT NULL REFERENCES people (id),
  status text NOT NULL CHECK (status IN ('queued', 'sent')),
  sent_at timestamptz,
  claimed_until timestamptz,
  PRIMARY KEY (rental_set_id, assistant_id)
);
`;
