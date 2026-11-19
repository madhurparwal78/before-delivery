import pg from 'pg';
import { config } from './config';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on('error', () => undefined);

export type Db = Pick<pg.PoolClient, 'query'>;

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}

export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS confirm_tokens (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(), closed boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS rate_events (bucket text NOT NULL, subject text NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS rate_events_lookup ON rate_events (bucket, subject, at);
CREATE TABLE IF NOT EXISTS models (
  id uuid PRIMARY KEY, bytes integer NOT NULL, sha256 text NOT NULL, bounds jsonb NOT NULL, nodes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS guides (
  id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL, currency text NOT NULL, tags jsonb NOT NULL DEFAULT '[]', visibility text NOT NULL DEFAULT 'public',
  state text NOT NULL DEFAULT 'draft', published_version integer, model_id uuid REFERENCES models(id),
  model_scale double precision NOT NULL DEFAULT 1, model_scale_confirmed boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0, source_guide_id uuid,
  source_title text, source_author text, source_version integer,
  search_text text NOT NULL DEFAULT '', published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS guides_published ON guides (published_at DESC, id DESC) WHERE state = 'published';
CREATE INDEX IF NOT EXISTS guides_source ON guides (source_guide_id);
CREATE TABLE IF NOT EXISTS coauthors (
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (guide_id, user_id));
CREATE TABLE IF NOT EXISTS steps (
  id uuid PRIMARY KEY, guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE, position integer NOT NULL,
  title text NOT NULL DEFAULT '', text text NOT NULL DEFAULT '', phase text NOT NULL DEFAULT 'take_out',
  explode double precision NOT NULL DEFAULT 0, focus_parts jsonb NOT NULL DEFAULT '[]',
  camera jsonb NOT NULL, callouts jsonb NOT NULL DEFAULT '[]');
CREATE INDEX IF NOT EXISTS steps_guide ON steps (guide_id, position);
CREATE TABLE IF NOT EXISTS parts (
  id uuid PRIMARY KEY, guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE, position integer NOT NULL,
  name text NOT NULL, node_path text NOT NULL, unbound boolean NOT NULL DEFAULT false, axis text NOT NULL DEFAULT 'y',
  apart_mm double precision NOT NULL DEFAULT 0, quantity integer NOT NULL DEFAULT 1, unit_price integer NOT NULL DEFAULT 0,
  fitted_at uuid);
CREATE INDEX IF NOT EXISTS parts_guide ON parts (guide_id, position);
CREATE TABLE IF NOT EXISTS field_revisions (
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE, field text NOT NULL, revision integer NOT NULL DEFAULT 0,
  by_user_id uuid REFERENCES users(id) ON DELETE SET NULL, PRIMARY KEY (guide_id, field));
CREATE TABLE IF NOT EXISTS versions (
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE, number integer NOT NULL, saved_at timestamptz NOT NULL DEFAULT now(),
  saved_by uuid REFERENCES users(id) ON DELETE SET NULL, restored_from integer, model_id uuid REFERENCES models(id),
  snapshot jsonb NOT NULL, PRIMARY KEY (guide_id, number));
CREATE INDEX IF NOT EXISTS versions_model ON versions (model_id);
CREATE TABLE IF NOT EXISTS likes (
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (guide_id, user_id));
CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY, guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE, step integer NOT NULL, text text NOT NULL,
  asked_by uuid NOT NULL REFERENCES users(id), asked_at timestamptz NOT NULL DEFAULT now(),
  answer_text text, answered_by uuid REFERENCES users(id), answered_at timestamptz);
CREATE INDEX IF NOT EXISTS questions_guide ON questions (guide_id, asked_at DESC);
CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, owner_id uuid NOT NULL REFERENCES users(id), title text NOT NULL,
  visibility text NOT NULL DEFAULT 'public', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE, guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  position integer NOT NULL, PRIMARY KEY (collection_id, guide_id));
`;

const MIGRATION_LOCK = 7_431_902;

/** Applies the schema idempotently; instances starting at once on one database serialise on an advisory lock. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(schema);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

export async function withAdvisoryLock<T>(key: number, db: Db, work: () => Promise<T>): Promise<T> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [key]);
  return work();
}
