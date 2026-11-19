import { Pool, type PoolClient, type QueryResultRow } from "pg";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_lower TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verify_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pens (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  head INT NOT NULL DEFAULT 0,
  forked_from_pen_id TEXT,
  forked_from_version INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS versions (
  pen_id TEXT NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  number INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sha256 TEXT NOT NULL,
  html TEXT NOT NULL,
  css TEXT NOT NULL,
  js TEXT NOT NULL,
  libraries TEXT[] NOT NULL DEFAULT '{}',
  restored_from INT,
  added INT NOT NULL DEFAULT 0,
  removed INT NOT NULL DEFAULT 0,
  changed_chars INT NOT NULL DEFAULT 0,
  PRIMARY KEY (pen_id, number)
);
CREATE TABLE IF NOT EXISTS tags (
  pen_id TEXT NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (pen_id, tag)
);
CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pen_id TEXT NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pen_id)
);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collection_pens (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  pen_id TEXT NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, pen_id)
);
CREATE TABLE IF NOT EXISTS idempotency (
  user_id TEXT NOT NULL,
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  status INT NOT NULL,
  response TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route, key)
);
CREATE INDEX IF NOT EXISTS versions_pen ON versions(pen_id, number);
CREATE INDEX IF NOT EXISTS pens_owner ON pens(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS pens_visibility ON pens(visibility);
`;

export class Database {
  private pool: Pool | null = null;
  private down = false;
  private migrateDone = false;
  private migratePromise: Promise<void> | null = null;

  constructor(private url: string) {}

  poolInst(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: this.url, max: 10, connectionTimeoutMillis: 3000 });
      this.pool.on("error", () => {
        this.down = true;
      });
    }
    return this.pool;
  }

  async migrate(): Promise<void> {
    if (this.migrateDone) return;
    if (this.migratePromise) return this.migratePromise;
    this.migratePromise = this.poolInst()
      .query(SCHEMA)
      .then(() => {
        this.migrateDone = true;
      })
      .catch((e) => {
        this.down = true;
        this.migratePromise = null;
        throw e;
      });
    return this.migratePromise;
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.migrate();
    const client = await this.poolInst().connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R[]> {
    await this.migrate();
    const res = await this.poolInst().query(text, params);
    return res.rows as R[];
  }

  markDown(): void {
    this.down = true;
  }

  isDown(): boolean {
    return this.down;
  }

  async ping(): Promise<boolean> {
    try {
      await this.poolInst().query("SELECT 1");
      this.down = false;
      return true;
    } catch {
      this.down = true;
      return false;
    }
  }
}
