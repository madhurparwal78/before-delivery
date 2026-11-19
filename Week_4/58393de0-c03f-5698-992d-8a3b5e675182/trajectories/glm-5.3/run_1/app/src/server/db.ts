import pg from 'pg';

const { Pool } = pg;

export interface DbConfig { databaseUrl: string }

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({ connectionString: databaseUrl, max: 20 });
}

// Applied on every serve start; safe to repeat (IF NOT EXISTS, additive).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT,
  classroom_id TEXT,
  nickname TEXT
);
CREATE TABLE IF NOT EXISTS verification_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  mail_accepted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  account_id TEXT,
  kind TEXT NOT NULL,
  pending_classroom_id TEXT,
  ended_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token);
CREATE TABLE IF NOT EXISTS classrooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  join_code TEXT NOT NULL,
  join_opens_at TIMESTAMPTZ NOT NULL,
  join_closes_at TIMESTAMPTZ NOT NULL,
  hand_in_at TIMESTAMPTZ NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS classroom_educators (
  classroom_id TEXT NOT NULL,
  educator_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (classroom_id, educator_id)
);
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS students_nick_uniq ON students(classroom_id, lower(nickname));
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  classroom_id TEXT,
  revision INT NOT NULL,
  handed_in BOOLEAN NOT NULL DEFAULT FALSE,
  saved_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  owner_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  format TEXT NOT NULL,
  unit TEXT NOT NULL,
  bytes INT NOT NULL,
  triangle_count INT,
  bbox_x DOUBLE PRECISION,
  bbox_y DOUBLE PRECISION,
  bbox_z DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS exports_owner_idx ON exports(owner_id);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, account_id, key)
);
CREATE TABLE IF NOT EXISTS join_attempts (
  ip TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS join_attempts_idx ON join_attempts(ip, attempted_at);
`;

// Additive migrations for tables created by earlier versions; safe to repeat.
const MIGRATIONS = `
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE verification_tokens ADD COLUMN IF NOT EXISTS mail_accepted BOOLEAN NOT NULL DEFAULT FALSE;
`;

export async function applySchema(pool: pg.Pool): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
}
