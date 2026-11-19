import pg from 'pg';
import { config } from './config';

pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 3000 });
pool.on('error', () => undefined);

export type Queryable = Pick<pg.Pool, 'query'>;
export type Row = Record<string, unknown>;

export async function rows<T = Row>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query(sql, params)).rows as T[];
}

export async function one<T = Row>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(q, sql, params))[0];
}

export async function transaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
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

export function isDatabaseDown(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? '';
  return /^(ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|08|57P|53300)/.test(code) || /Connection terminated|timeout exceeded when trying to connect/.test(String((error as Error).message));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clock (id int PRIMARY KEY CHECK (id = 1), offset_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false, code text, number_format text NOT NULL DEFAULT 'en-US',
  time_zone text NOT NULL DEFAULT 'UTC');
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, user_id int NOT NULL REFERENCES users ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS projects (id serial PRIMARY KEY, name text NOT NULL, owner_id int NOT NULL REFERENCES users, created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (
  project_id int NOT NULL REFERENCES projects ON DELETE CASCADE, user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  role text NOT NULL, PRIMARY KEY (project_id, user_id));
CREATE TABLE IF NOT EXISTS invites (
  id serial PRIMARY KEY, project_id int NOT NULL REFERENCES projects ON DELETE CASCADE, email text NOT NULL, role text NOT NULL,
  token text UNIQUE NOT NULL, state text NOT NULL, expires_at bigint NOT NULL, created_by int NOT NULL REFERENCES users, created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS palettes (id serial PRIMARY KEY, ord int[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS swatches (
  palette_id int NOT NULL REFERENCES palettes ON DELETE CASCADE, idx int NOT NULL, color text NOT NULL, version int NOT NULL,
  edited_by int REFERENCES users, removed boolean NOT NULL DEFAULT false, removed_by int REFERENCES users, PRIMARY KEY (palette_id, idx));
CREATE TABLE IF NOT EXISTS sprites (
  id serial PRIMARY KEY, project_id int NOT NULL REFERENCES projects ON DELETE CASCADE, palette_id int NOT NULL REFERENCES palettes,
  name text NOT NULL, width int NOT NULL, height int NOT NULL, seq int NOT NULL DEFAULT 0, created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS layers (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, name text NOT NULL, opacity int NOT NULL,
  blend text NOT NULL, visible boolean NOT NULL, locked_by int REFERENCES users, position int NOT NULL);
CREATE TABLE IF NOT EXISTS frames (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, position int NOT NULL, duration_ms int NOT NULL);
CREATE TABLE IF NOT EXISTS buffers (id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, data bytea NOT NULL);
CREATE TABLE IF NOT EXISTS cels (
  frame_id int NOT NULL REFERENCES frames ON DELETE CASCADE, layer_id int NOT NULL REFERENCES layers ON DELETE CASCADE,
  buffer_id int NOT NULL REFERENCES buffers, PRIMARY KEY (frame_id, layer_id));
CREATE TABLE IF NOT EXISTS tags (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, name text NOT NULL, from_frame int NOT NULL,
  to_frame int NOT NULL, direction text NOT NULL, repeat int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tilesets (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, name text NOT NULL, tile_size int NOT NULL,
  edge_table int[] NOT NULL);
CREATE TABLE IF NOT EXISTS tiles (
  tileset_id int NOT NULL REFERENCES tilesets ON DELETE CASCADE, number int NOT NULL, data bytea NOT NULL, PRIMARY KEY (tileset_id, number));
CREATE TABLE IF NOT EXISTS tilemaps (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, tileset_id int NOT NULL REFERENCES tilesets ON DELETE CASCADE,
  name text NOT NULL, width int NOT NULL, height int NOT NULL);
CREATE TABLE IF NOT EXISTS map_cells (
  tilemap_id int NOT NULL REFERENCES tilemaps ON DELETE CASCADE, x int NOT NULL, y int NOT NULL, tile int NOT NULL,
  flip_h boolean NOT NULL, flip_v boolean NOT NULL, PRIMARY KEY (tilemap_id, x, y));
CREATE TABLE IF NOT EXISTS events (
  sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, seq int NOT NULL, type text NOT NULL, by_user int REFERENCES users,
  at bigint NOT NULL, data jsonb NOT NULL, changes jsonb, PRIMARY KEY (sprite_id, seq));
CREATE TABLE IF NOT EXISTS stroke_log (
  sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, user_id int NOT NULL, csid text NOT NULL, response jsonb NOT NULL,
  PRIMARY KEY (sprite_id, user_id, csid));
CREATE TABLE IF NOT EXISTS undo_entries (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, user_id int NOT NULL, side text NOT NULL,
  seq int NOT NULL, changes jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS undo_entries_owner ON undo_entries (sprite_id, user_id, side, id);
CREATE TABLE IF NOT EXISTS comments (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, author_id int NOT NULL REFERENCES users,
  frame int NOT NULL, x int NOT NULL, y int NOT NULL, text text NOT NULL, state text NOT NULL, created_at bigint NOT NULL,
  seq int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS comment_keys (
  user_id int NOT NULL, key text NOT NULL, fingerprint text NOT NULL, comment_id int, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS mentions (
  comment_id int NOT NULL REFERENCES comments ON DELETE CASCADE, user_id int NOT NULL REFERENCES users, state text NOT NULL,
  PRIMARY KEY (comment_id, user_id));
CREATE TABLE IF NOT EXISTS outbox (
  id serial PRIMARY KEY, to_email text NOT NULL, subject text NOT NULL, body text NOT NULL, state text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(), mention_comment int, mention_user int);
CREATE TABLE IF NOT EXISTS snapshots (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, name text NOT NULL, seq int NOT NULL,
  at bigint NOT NULL, automatic boolean NOT NULL DEFAULT false, data bytea NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE, key text NOT NULL, text text NOT NULL, version int NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS share_links (
  id serial PRIMARY KEY, sprite_id int NOT NULL REFERENCES sprites ON DELETE CASCADE, label text NOT NULL, token text UNIQUE NOT NULL,
  expires_at bigint, revoked boolean NOT NULL DEFAULT false, notified boolean NOT NULL DEFAULT false, created_by int REFERENCES users);
CREATE TABLE IF NOT EXISTS imports (
  id serial PRIMARY KEY, project_id int NOT NULL REFERENCES projects ON DELETE CASCADE, sprite_id int NOT NULL, file_name text NOT NULL,
  object_key text NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id serial PRIMARY KEY, kind text NOT NULL, project_id int NOT NULL REFERENCES projects ON DELETE CASCADE, sprite_id int, user_id int NOT NULL,
  label text NOT NULL, settings jsonb NOT NULL, state text NOT NULL, done int NOT NULL DEFAULT 0, total int NOT NULL, seq int NOT NULL DEFAULT 0,
  payload bytea NOT NULL, files jsonb NOT NULL DEFAULT '[]', export_id int, claimed_by text, lease_until timestamptz, created_at bigint NOT NULL);
CREATE SEQUENCE IF NOT EXISTS export_ids;
CREATE TABLE IF NOT EXISTS exports (
  id int PRIMARY KEY, job_id int NOT NULL REFERENCES jobs ON DELETE CASCADE, project_id int NOT NULL REFERENCES projects ON DELETE CASCADE,
  label text NOT NULL, seq int NOT NULL, files jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS activity (
  id serial PRIMARY KEY, project_id int NOT NULL REFERENCES projects ON DELETE CASCADE, user_id int NOT NULL, sprite_id int,
  kind text NOT NULL, data jsonb NOT NULL, first_at bigint NOT NULL);
`;

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(7351001)');
    try {
      await client.query(SCHEMA);
    } finally {
      await client.query('SELECT pg_advisory_unlock(7351001)');
    }
  } finally {
    client.release();
  }
}
