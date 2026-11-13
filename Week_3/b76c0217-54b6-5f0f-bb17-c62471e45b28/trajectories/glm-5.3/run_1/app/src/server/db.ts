import * as pg from 'pg';
import { config } from '../config';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  accepted_at timestamptz
);
CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  slug text NOT NULL,
  title text NOT NULL,
  default_version_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  slug text NOT NULL,
  title text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tabs (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES versions(id),
  title text NOT NULL,
  position int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY,
  tab_id text NOT NULL REFERENCES tabs(id),
  title text NOT NULL,
  position int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pages (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES versions(id),
  group_id text REFERENCES groups(id),
  position int NOT NULL DEFAULT 0,
  path text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  operation_id text,
  source text NOT NULL,
  revision int NOT NULL DEFAULT 0,
  state text NOT NULL,
  has_draft_changes boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS redirects (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES versions(id),
  from_path text NOT NULL,
  to_path text NOT NULL,
  kind text NOT NULL,
  UNIQUE(version_id, from_path)
);
CREATE TABLE IF NOT EXISTS publish_attempts (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES versions(id),
  status text NOT NULL,
  published_at timestamptz,
  snapshot_id text,
  errors jsonb NOT NULL DEFAULT '[]',
  pages_count int NOT NULL DEFAULT 0,
  changed_pages int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text NOT NULL,
  version_id text NOT NULL REFERENCES versions(id),
  status int NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(key, version_id)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES versions(id),
  manifest jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS snapshot_pages (
  snapshot_id text NOT NULL REFERENCES snapshots(id),
  path text NOT NULL,
  html text NOT NULL,
  PRIMARY KEY(snapshot_id, path)
);
CREATE TABLE IF NOT EXISTS images (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  content_type text NOT NULL,
  bytes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS openapi_imports (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES versions(id),
  file_name text NOT NULL,
  bytes int NOT NULL,
  sha256 text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS preview_links (
  id text PRIMARY KEY,
  page_id text NOT NULL REFERENCES pages(id),
  token text NOT NULL UNIQUE,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  reader_key text NOT NULL,
  page_id text NOT NULL REFERENCES pages(id),
  vote text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(reader_key, page_id)
);
CREATE TABLE IF NOT EXISTS search_records (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES versions(id),
  term text NOT NULL,
  results int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_records_version_idx ON search_records(version_id, created_at);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  content_type text NOT NULL,
  bytes int NOT NULL
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS sites_team_slug_idx ON sites(team_id, slug)');
}
