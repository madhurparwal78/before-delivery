import pg from 'pg'
import { config } from './config.ts'
import { databaseUnavailable } from './errors.ts'

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 2000, idleTimeoutMillis: 10000 })
pool.on('error', () => undefined)

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sign_in_codes (
  email text PRIMARY KEY,
  display_name text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  text text NOT NULL,
  valid_text text NOT NULL,
  layout jsonb NOT NULL,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);
CREATE TABLE IF NOT EXISTS edit_log (
  project_id uuid NOT NULL REFERENCES projects(id),
  revision integer NOT NULL,
  base_revision integer NOT NULL,
  text text NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision)
);
CREATE TABLE IF NOT EXISTS versions (
  project_id uuid NOT NULL REFERENCES projects(id),
  number integer NOT NULL,
  name text NOT NULL,
  revision integer NOT NULL,
  text text NOT NULL,
  layout jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  restored_from integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, number)
);
CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  access text NOT NULL,
  token text NOT NULL UNIQUE,
  email text,
  invitation_status text,
  invitation_sent_at timestamptz,
  state text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  replaced_by uuid
);
CREATE INDEX IF NOT EXISTS shares_project ON shares(project_id);
CREATE TABLE IF NOT EXISTS members (
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL,
  joined_via uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS removed_members (
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES users(id),
  removed_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES users(id),
  dialect text NOT NULL,
  status text NOT NULL,
  key text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  file_name text NOT NULL,
  revision integer NOT NULL,
  stored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exports_project ON exports(project_id);
CREATE INDEX IF NOT EXISTS exports_user ON exports(user_id, created_at);
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES users(id),
  dialect text NOT NULL,
  mode text NOT NULL,
  key text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imports_project ON imports(project_id);
`

let ready = false

/** Applies the schema idempotently; keeps retrying every 2 seconds while PostgreSQL is unreachable. */
export function startDatabase(): void {
  const attempt = async (): Promise<void> => {
    const client = await pool.connect().catch(() => null)
    if (!client) {
      setTimeout(() => void attempt(), 2000)
      return
    }
    try {
      await client.query('SELECT pg_advisory_lock(7101)')
      await client.query(SCHEMA)
      await client.query('SELECT pg_advisory_unlock(7101)')
      ready = true
    } catch {
      setTimeout(() => void attempt(), 2000)
    } finally {
      client.release()
    }
  }
  void attempt()
}

type Row = Record<string, unknown>
export type Queryable = Pick<pg.PoolClient, 'query'>

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return ready
  } catch {
    return false
  }
}

export async function query<T extends object = Row>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  if (!ready) throw databaseUnavailable()
  try {
    return (await db.query(sql, params)).rows as T[]
  } catch (error) {
    if (error instanceof pg.DatabaseError) throw error
    throw databaseUnavailable()
  }
}

export async function one<T extends object = Row>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T | undefined> {
  return (await query<T>(sql, params, db))[0]
}

/** The first row of a statement that always returns one (an insert or update with RETURNING, a count). */
export async function exactlyOne<T extends object = Row>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T> {
  const row = await one<T>(sql, params, db)
  if (!row) throw new Error('The statement returned no row.')
  return row
}

export async function transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T> {
  if (!ready) throw databaseUnavailable()
  const client = await pool.connect().catch(() => {
    throw databaseUnavailable()
  })
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
