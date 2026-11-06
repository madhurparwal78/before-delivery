import pg from 'pg';
import { config } from './config';

// bigint columns hold cents well under 2^53.
pg.types.setTypeParser(20, Number);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 16 });

// The pool reports a dropped idle connection here; the next query opens a fresh one.
pool.on('error', () => undefined);

export type Runner = Pick<pg.PoolClient, 'query'>;
export type Row = Record<string, any>;

export async function rows<T extends Row = Row>(db: Runner, sql: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, values)).rows;
}

export async function one<T extends Row = Row>(db: Runner, sql: string, values: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, values)).rows[0];
}

export async function transaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS desks (
  id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL, email_key text NOT NULL UNIQUE,
  password_hash text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, desk_id uuid NOT NULL REFERENCES desks ON DELETE CASCADE, ends_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY, desk_id uuid NOT NULL REFERENCES desks, name text NOT NULL, name_key text NOT NULL,
  place text NOT NULL, state text NOT NULL, closes_at timestamptz, erased_at timestamptz, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS clients_desk ON clients (desk_id);
CREATE TABLE IF NOT EXISTS producers (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients ON DELETE CASCADE, name text NOT NULL, name_key text NOT NULL,
  email text NOT NULL, town text NOT NULL, language text NOT NULL, created_at timestamptz NOT NULL, seq bigserial
);
CREATE INDEX IF NOT EXISTS producers_client ON producers (client_id);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY, desk_id uuid NOT NULL REFERENCES desks, client_id uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
  title text NOT NULL, title_key text NOT NULL, ad_id text NOT NULL, due_date text NOT NULL, target_seconds int NOT NULL,
  frame_rate text NOT NULL, aspect text NOT NULL, state text NOT NULL, stamp text NOT NULL, stamp_at timestamptz NOT NULL,
  next_frame int NOT NULL DEFAULT 1, next_cut int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_desk ON jobs (desk_id, due_date, id);
CREATE TABLE IF NOT EXISTS frames (
  job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE, number int NOT NULL, position int, duration_frames int NOT NULL,
  action_note text NOT NULL, audio_note text NOT NULL, shot text NOT NULL, visual text NOT NULL,
  file_name text, width int, height int, sha256 text, drawing_seed int,
  removed_position int, removal_ends_at timestamptz,
  PRIMARY KEY (job_id, number)
);
CREATE TABLE IF NOT EXISTS lines (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE, frame int NOT NULL, market text NOT NULL,
  text text NOT NULL, x double precision NOT NULL, y double precision NOT NULL, width double precision NOT NULL,
  height double precision NOT NULL, clips int NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS cues (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE, track_id text NOT NULL, title text NOT NULL,
  composer text NOT NULL, seconds int NOT NULL, market text NOT NULL, from_date text NOT NULL, until_date text NOT NULL,
  fee text NOT NULL, licence_id text NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS cuts (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE, number int NOT NULL, name text NOT NULL,
  frame_rate text NOT NULL, frames jsonb NOT NULL, created_at timestamptz NOT NULL, signed_off_at timestamptz, signed_off_by text,
  UNIQUE (job_id, number)
);
CREATE TABLE IF NOT EXISTS renders (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE, cut int NOT NULL, width int NOT NULL,
  burn_timecode boolean NOT NULL, state text NOT NULL, progress int NOT NULL DEFAULT 0, message text, provider_id text,
  next_poll_at timestamptz, size int, sha256 text, created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS renders_once ON renders (job_id, cut, width, burn_timecode) WHERE state <> 'failed';
CREATE TABLE IF NOT EXISTS private_pages (
  id uuid PRIMARY KEY, kind text NOT NULL, token text NOT NULL UNIQUE, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES producers ON DELETE CASCADE, cut int, ends_at timestamptz NOT NULL, ended_at timestamptz,
  ended_by text, typed_name text, reminder_at timestamptz, reminder_sent boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS private_pages_job ON private_pages (job_id, kind);
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE, producer_id uuid NOT NULL REFERENCES producers ON DELETE CASCADE,
  content_type text NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY, seq bigserial, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE,
  page_id uuid REFERENCES private_pages ON DELETE SET NULL, producer_id uuid NOT NULL REFERENCES producers ON DELETE CASCADE,
  frame int NOT NULL, timecode text NOT NULL, x double precision NOT NULL, y double precision NOT NULL, typed_name text NOT NULL,
  state text NOT NULL, text text NOT NULL, suggested_seconds text, suggested_frames int, attachment_id uuid REFERENCES attachments ON DELETE SET NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_job ON notes (job_id, seq);
CREATE TABLE IF NOT EXISTS send_keys (
  page_id uuid NOT NULL REFERENCES private_pages ON DELETE CASCADE, send_key text NOT NULL, answer jsonb NOT NULL,
  PRIMARY KEY (page_id, send_key)
);
CREATE TABLE IF NOT EXISTS history (
  seq bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE, at timestamptz NOT NULL,
  actor text NOT NULL, action text NOT NULL, text text NOT NULL
);
CREATE INDEX IF NOT EXISTS history_job ON history (job_id, seq);
CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY, desk_id uuid NOT NULL REFERENCES desks, producer_id uuid NOT NULL REFERENCES producers ON DELETE CASCADE,
  date text NOT NULL, time text NOT NULL, minutes int NOT NULL, note text NOT NULL, starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL, uid text NOT NULL, sequence int NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_desk ON calls (desk_id, starts_at);
CREATE TABLE IF NOT EXISTS packages (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE, cut int NOT NULL, state text NOT NULL,
  files jsonb NOT NULL, created_at timestamptz NOT NULL, UNIQUE (job_id, cut)
);
CREATE TABLE IF NOT EXISTS letters (
  id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES jobs ON DELETE CASCADE, currency text NOT NULL, scope text NOT NULL,
  fee_minor bigint NOT NULL, tax_minor bigint NOT NULL, milestones jsonb NOT NULL, state text NOT NULL, stamp text NOT NULL,
  stamp_at timestamptz NOT NULL, producer_id uuid REFERENCES producers ON DELETE SET NULL, page_id uuid REFERENCES private_pages ON DELETE SET NULL,
  pdf_stored boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS pending_mail (
  id uuid PRIMARY KEY, seq bigserial, client_id uuid REFERENCES clients ON DELETE CASCADE, recipient text NOT NULL, subject text NOT NULL,
  body text NOT NULL, calendar text, calendar_method text, sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS pending_mail_unsent ON pending_mail (seq) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS rate_events (key text NOT NULL, at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS rate_events_key ON rate_events (key, at);
`;
