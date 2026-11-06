import { Pool } from 'pg';

// Apply the schema idempotently; safe to call repeatedly.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  device_id UUID NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_records (
  account_id UUID NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  document_id TEXT,
  version BIGINT NOT NULL DEFAULT 1,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB,
  base_version BIGINT,
  PRIMARY KEY (account_id, record_id)
);

CREATE TABLE IF NOT EXISTS sync_log (
  seq BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version BIGINT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB,
  device_id UUID,
  conflict BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_log_account_seq ON sync_log (account_id, seq);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  account_id UUID NOT NULL,
  record_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  a_payload TEXT,
  b_payload TEXT,
  PRIMARY KEY (account_id, record_id)
);

CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS share_links_user_doc ON share_links (user_id, document_id);
`;

export class Db {
  pool: Pool;
  private ready = false;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async applySchema(): Promise<boolean> {
    try {
      await this.pool.query(SCHEMA_SQL);
      // Idempotent migrations for columns added after first creation.
      await this.pool.query(`ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS conflict BOOLEAN NOT NULL DEFAULT FALSE`);
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  markDown(): void {
    this.ready = false;
  }

  async check(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      if (!this.ready) await this.applySchema();
      return true;
    } catch {
      return false;
    }
  }
}
