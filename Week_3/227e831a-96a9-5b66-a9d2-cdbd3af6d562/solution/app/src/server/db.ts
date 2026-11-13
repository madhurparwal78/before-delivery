import pg from 'pg'
import { config } from './config'

pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10))

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 })
pool.on('error', () => undefined)

export type Db = Pick<pg.PoolClient, 'query'>

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows
}

/** Runs work in one transaction; the work rolls back as a whole if it throws. */
export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export function uniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ids that cannot be ours are answered as not found rather than sent to the database. */
export function asId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id int PRIMARY KEY CHECK (id = 1),
  display_name text NOT NULL,
  unit text NOT NULL,
  goal_grams int NOT NULL,
  time_zone text NOT NULL,
  paper_size text NOT NULL,
  passphrase_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  name_key text NOT NULL,
  category text NOT NULL,
  weight_grams int NOT NULL CHECK (weight_grams >= 0),
  units_owned int NOT NULL CHECK (units_owned >= 0),
  price_cents int,
  notes text NOT NULL DEFAULT '',
  version int NOT NULL DEFAULT 1,
  photo_id uuid,
  seq bigserial,
  UNIQUE (category, name_key)
);
CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  extension text NOT NULL,
  content_type text NOT NULL
);
CREATE TABLE IF NOT EXISTS lists (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  state text NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS lines (
  id uuid PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  quantity int NOT NULL CHECK (quantity >= 1),
  mode text NOT NULL,
  frozen_name text,
  frozen_weight_grams int,
  position bigserial,
  UNIQUE (list_id, item_id)
);
CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS shares_one_active ON shares (list_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS pack_sheets (
  id uuid PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  bytes int NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY,
  filename text NOT NULL,
  bytes int NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS import_rows (
  import_id uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row int NOT NULL,
  name text NOT NULL,
  category_text text NOT NULL,
  outcome text NOT NULL,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  same_as_row int,
  reason text,
  gear jsonb,
  PRIMARY KEY (import_id, row)
);
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id text PRIMARY KEY,
  op jsonb NOT NULL,
  result text NOT NULL,
  reason text
);
CREATE TABLE IF NOT EXISTS retire_keys (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  key text NOT NULL,
  body jsonb NOT NULL,
  status int NOT NULL,
  response text NOT NULL,
  PRIMARY KEY (item_id, key)
);
`
