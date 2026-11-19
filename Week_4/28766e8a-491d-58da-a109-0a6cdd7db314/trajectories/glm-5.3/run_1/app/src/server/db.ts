import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS diagrams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (diagram_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documents (
  diagram_id TEXT PRIMARY KEY REFERENCES diagrams(id) ON DELETE CASCADE,
  content JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
  diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  op JSONB NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (diagram_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS operations_op_id
  ON operations (diagram_id, user_id, op_id);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  shape_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  parent TEXT,
  text TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  anchored BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  name TEXT,
  author_id TEXT NOT NULL REFERENCES users(id),
  seq INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content JSONB NOT NULL,
  UNIQUE (diagram_id, number)
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  format TEXT NOT NULL,
  scale INTEGER NOT NULL,
  background TEXT NOT NULL,
  seq INTEGER NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS version_timers (
  diagram_id TEXT PRIMARY KEY REFERENCES diagrams(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL
);
`;

export interface Db {
  pool: pg.Pool;
  query(text: string, params?: unknown[]): Promise<pg.QueryResult>;
  withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
}

export async function connectDb(databaseUrl: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 20 });
  const query = async (text: string, params?: unknown[]) => pool.query(text, params as never[]);
  const withTransaction = async <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
      throw err;
    } finally {
      client.release();
    }
  };
  await pool.query(SCHEMA);
  return { pool, query, withTransaction };
}
