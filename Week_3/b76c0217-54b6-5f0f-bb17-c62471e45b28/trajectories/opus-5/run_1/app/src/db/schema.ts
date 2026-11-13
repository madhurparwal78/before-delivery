import { db } from './pool';

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS teams (
     id text PRIMARY KEY,
     name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     team_id text NOT NULL REFERENCES teams(id),
     email text NOT NULL UNIQUE,
     name text NOT NULL,
     password_hash text NOT NULL,
     role text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sites (
     id text PRIMARY KEY,
     team_id text NOT NULL REFERENCES teams(id),
     slug text NOT NULL UNIQUE,
     title text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS versions (
     id text PRIMARY KEY,
     site_id text NOT NULL REFERENCES sites(id),
     slug text NOT NULL,
     title text NOT NULL,
     is_default boolean NOT NULL DEFAULT false,
     published_at timestamptz,
     live_snapshot_id text,
     position integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (site_id, slug)
   )`,
  `CREATE TABLE IF NOT EXISTS tabs (
     id text PRIMARY KEY,
     version_id text NOT NULL REFERENCES versions(id),
     title text NOT NULL,
     position integer NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS groups (
     id text PRIMARY KEY,
     version_id text NOT NULL REFERENCES versions(id),
     tab_id text NOT NULL REFERENCES tabs(id),
     title text NOT NULL,
     position integer NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS pages (
     id text PRIMARY KEY,
     version_id text NOT NULL REFERENCES versions(id),
     group_id text NOT NULL REFERENCES groups(id),
     path text NOT NULL,
     title text NOT NULL,
     kind text NOT NULL,
     operation_id text,
     source text NOT NULL,
     revision integer NOT NULL,
     state text NOT NULL,
     has_draft_changes boolean NOT NULL DEFAULT true,
     position integer NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     updated_by text REFERENCES users(id)
   )`,
  `CREATE TABLE IF NOT EXISTS redirects (
     version_id text NOT NULL REFERENCES versions(id),
     from_path text NOT NULL,
     to_path text NOT NULL,
     kind text NOT NULL,
     PRIMARY KEY (version_id, from_path)
   )`,
  `CREATE TABLE IF NOT EXISTS publish_attempts (
     id text PRIMARY KEY,
     version_id text NOT NULL REFERENCES versions(id),
     status text NOT NULL,
     errors jsonb NOT NULL DEFAULT '[]'::jsonb,
     published_at timestamptz,
     snapshot_id text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     key text PRIMARY KEY,
     version_id text NOT NULL REFERENCES versions(id),
     status integer NOT NULL,
     response json NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS snapshots (
     id text PRIMARY KEY,
     version_id text NOT NULL REFERENCES versions(id),
     published_at timestamptz NOT NULL,
     navigation json NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS snapshot_pages (
     snapshot_id text NOT NULL REFERENCES snapshots(id),
     page_id text NOT NULL,
     path text NOT NULL,
     title text NOT NULL,
     kind text NOT NULL,
     operation_id text,
     group_id text NOT NULL,
     group_title text NOT NULL,
     tab_id text NOT NULL,
     html text NOT NULL,
     body_text text NOT NULL,
     headings json NOT NULL,
     position integer NOT NULL,
     object_key text NOT NULL,
     PRIMARY KEY (snapshot_id, page_id)
   )`,
  `CREATE TABLE IF NOT EXISTS votes (
     reader_id text NOT NULL,
     page_id text NOT NULL REFERENCES pages(id),
     vote text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (reader_id, page_id)
   )`,
  `CREATE TABLE IF NOT EXISTS search_records (
     id bigserial PRIMARY KEY,
     site_id text NOT NULL REFERENCES sites(id),
     version_id text NOT NULL REFERENCES versions(id),
     term text NOT NULL,
     results integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS preview_links (
     id text PRIMARY KEY,
     page_id text NOT NULL REFERENCES pages(id),
     token text NOT NULL UNIQUE,
     expires_at timestamptz NOT NULL,
     revoked boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS invites (
     id text PRIMARY KEY,
     team_id text NOT NULL REFERENCES teams(id),
     invited_by text NOT NULL REFERENCES users(id),
     email text NOT NULL,
     role text NOT NULL,
     status text NOT NULL,
     token text NOT NULL UNIQUE,
     created_at timestamptz NOT NULL DEFAULT now(),
     sent_at timestamptz,
     expires_at timestamptz NOT NULL,
     accepted_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS openapi_imports (
     id text PRIMARY KEY,
     version_id text NOT NULL REFERENCES versions(id),
     group_id text NOT NULL,
     file_name text NOT NULL,
     bytes integer NOT NULL,
     sha256 text NOT NULL,
     object_key text NOT NULL,
     spec jsonb NOT NULL,
     imported_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS assets (
     id text PRIMARY KEY,
     site_id text NOT NULL REFERENCES sites(id),
     content_type text NOT NULL,
     bytes integer NOT NULL,
     object_key text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS pages_version_idx ON pages (version_id)`,
  `CREATE INDEX IF NOT EXISTS groups_version_idx ON groups (version_id)`,
  `CREATE INDEX IF NOT EXISTS snapshot_pages_snapshot_idx ON snapshot_pages (snapshot_id)`,
  `CREATE INDEX IF NOT EXISTS publish_attempts_version_idx ON publish_attempts (version_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS search_records_site_idx ON search_records (site_id)`,
];

export async function applySchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.query(statement);
  }
}
