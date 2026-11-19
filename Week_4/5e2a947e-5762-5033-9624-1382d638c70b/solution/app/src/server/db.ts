import pg from 'pg';
import { config } from './config.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS maps (
  id text PRIMARY KEY,
  title text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id),
  revision integer NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  doc jsonb NOT NULL,
  version_baseline timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  home text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS members (
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL,
  PRIMARY KEY (map_id, user_id)
);
CREATE TABLE IF NOT EXISTS ops_log (
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  group_id text NOT NULL,
  author_id text NOT NULL,
  author text NOT NULL,
  base_revision integer NOT NULL,
  origin text NOT NULL,
  ops jsonb NOT NULL,
  sentence text NOT NULL,
  topic_id text,
  restricted boolean NOT NULL DEFAULT false,
  removed jsonb NOT NULL DEFAULT '[]',
  at timestamptz NOT NULL,
  PRIMARY KEY (map_id, revision)
);
CREATE TABLE IF NOT EXISTS op_groups (
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  group_id text NOT NULL,
  author_id text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (map_id, group_id)
);
CREATE TABLE IF NOT EXISTS op_ids (
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  op_id text NOT NULL,
  group_id text NOT NULL,
  PRIMARY KEY (map_id, op_id)
);
CREATE TABLE IF NOT EXISTS events (
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  type text NOT NULL,
  body jsonb NOT NULL,
  audience text NOT NULL,
  only_id text,
  PRIMARY KEY (map_id, seq)
);
CREATE TABLE IF NOT EXISTS undo_stack (
  id bigserial PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  kind text NOT NULL,
  entry jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS undo_stack_owner ON undo_stack (map_id, user_id, kind, id);
CREATE TABLE IF NOT EXISTS collapse (
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  topic_id text NOT NULL,
  PRIMARY KEY (map_id, user_id, topic_id)
);
CREATE TABLE IF NOT EXISTS recovered (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  from_title text NOT NULL,
  parent_id text,
  chain jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  topic_id text NOT NULL,
  author_id text NOT NULL,
  author text NOT NULL,
  body text NOT NULL,
  reply_to text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_topic ON comments (map_id, topic_id);
CREATE TABLE IF NOT EXISTS votes (
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  topic_id text NOT NULL,
  user_id text NOT NULL,
  PRIMARY KEY (map_id, topic_id, user_id)
);
CREATE TABLE IF NOT EXISTS mentions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  topic_id text NOT NULL,
  comment_id text NOT NULL,
  by_name text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  number integer NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  by_name text NOT NULL,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (map_id, number)
);
CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  role text NOT NULL,
  expires_at timestamptz,
  state text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_sessions (
  token_hash text PRIMARY KEY,
  id text NOT NULL UNIQUE,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  link_id text NOT NULL REFERENCES share_links(id),
  display_name text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS presentations (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  state text NOT NULL,
  slide_index integer NOT NULL DEFAULT 0,
  presenter_id text NOT NULL,
  presenter text NOT NULL,
  presenter_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  format text NOT NULL,
  topic_id text,
  state text NOT NULL,
  progress integer NOT NULL,
  step_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  topic_id text NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL,
  type text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
  id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  bytes integer NOT NULL,
  topic_count integer NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS clipboards (
  user_id text PRIMARY KEY,
  payload jsonb NOT NULL
);
`;

let pool: pg.Pool | null = null;

export const database = (): pg.Pool => {
  if (!pool) throw new Error('database is not connected');
  return pool;
};

export const isDatabaseReady = (): boolean => pool !== null;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connect and apply the schema, retrying every second until the database answers. Applied on every serve.
 * `onRetry` runs after each failed attempt, so the server can start answering `starting` meanwhile.
 */
export async function connectDatabase(onRetry: () => void): Promise<void> {
  for (;;) {
    const candidate = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 3000 });
    candidate.on('error', () => undefined);
    try {
      await candidate.query(SCHEMA);
      pool = candidate;
      return;
    } catch {
      onRetry();
      await candidate.end().catch(() => undefined);
      await sleep(1000);
    }
  }
}

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(text, values)).rows;
}

/** Run work in one transaction that holds the map's advisory lock, so a map changes one group at a time. */
export async function withMapLock<T>(mapId: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [mapId]);
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
