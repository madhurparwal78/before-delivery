import { Pool } from "pg";
let pool = null;
let ready = false;
export function createPool(url) {
    pool = new Pool({ connectionString: url, max: 10 });
    return pool;
}
export function getPool() {
    if (pool === null)
        throw new Error("pool not created");
    return pool;
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS signup_codes (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sequence BIGINT NOT NULL DEFAULT 0,
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS documents (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  _id TEXT NOT NULL,
  body JSONB NOT NULL,
  version INT NOT NULL DEFAULT 1,
  seq BIGINT NOT NULL,
  PRIMARY KEY (collection_id, _id)
);
CREATE TABLE IF NOT EXISTS indexes (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  keys JSONB NOT NULL,
  unique_flag BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (collection_id, name)
);
CREATE TABLE IF NOT EXISTS validators (
  collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
  validator JSONB
);
CREATE TABLE IF NOT EXISTS pipeline_drafts (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stages JSONB NOT NULL,
  disabled JSONB NOT NULL,
  PRIMARY KEY (collection_id, user_id)
);
CREATE TABLE IF NOT EXISTS saved_queries (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filter JSONB NOT NULL,
  projection JSONB,
  sort JSONB,
  "limit" INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_count INT,
  UNIQUE (collection_id, name)
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  format TEXT NOT NULL,
  state TEXT NOT NULL,
  bytes BIGINT NOT NULL DEFAULT 0,
  inserted INT NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  file_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS unique_entries (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  index_name TEXT NOT NULL,
  key_text TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  PRIMARY KEY (collection_id, index_name, key_text)
);
CREATE INDEX IF NOT EXISTS unique_entries_doc ON unique_entries (collection_id, doc_id);
CREATE TABLE IF NOT EXISTS changes (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  op TEXT NOT NULL,
  _id TEXT NOT NULL,
  document JSONB,
  version INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, seq)
);
`;
/** Unique index entries for enforcement: key pattern per index. */
export async function applySchema(pool) {
    const client = await pool.connect();
    try {
        await client.query(SCHEMA);
    }
    finally {
        client.release();
    }
    ready = true;
}
export function dbReady() {
    return ready;
}
export async function withTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
}
