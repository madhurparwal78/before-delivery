import { db } from './db';

// Applied every time the server starts; every statement is idempotent.
const statements = [
  `create table if not exists teams (
     id text primary key, name text not null, created_at timestamptz not null default now())`,
  `create table if not exists users (
     id text primary key, team_id text not null references teams(id), email text not null unique,
     name text not null, password_hash text not null, role text not null, created_at timestamptz not null default now())`,
  `create table if not exists sessions (
     token_hash text primary key, user_id text not null references users(id), created_at timestamptz not null default now())`,
  `create table if not exists sites (
     id text primary key, team_id text not null references teams(id), slug text not null unique, title text not null,
     created_at timestamptz not null default now())`,
  `create table if not exists versions (
     id text primary key, site_id text not null references sites(id), slug text not null, title text not null,
     is_default boolean not null default false, live_snapshot_id text, published_at timestamptz,
     created_at timestamptz not null default clock_timestamp(), unique (site_id, slug))`,
  `create table if not exists tabs (
     id text primary key, version_id text not null references versions(id), title text not null, position integer not null)`,
  `create table if not exists groups (
     id text primary key, tab_id text not null references tabs(id), version_id text not null references versions(id),
     title text not null, position integer not null)`,
  `create table if not exists pages (
     id text primary key, version_id text not null references versions(id), group_id text not null references groups(id),
     position integer not null, path text not null, title text not null, kind text not null default 'page',
     operation_id text, source text not null, revision integer not null default 1, removed boolean not null default false,
     published_once boolean not null default false, sig text not null, published_sig text,
     updated_at timestamptz not null default now(), updated_by text not null references users(id))`,
  `create index if not exists pages_version on pages (version_id)`,
  `create table if not exists redirects (
     id bigserial primary key, version_id text not null references versions(id), from_path text not null,
     to_path text not null, kind text not null, unique (version_id, from_path))`,
  `create table if not exists publish_attempts (
     id bigserial primary key, version_id text not null references versions(id), status text not null,
     errors text not null default '[]', snapshot_id text, published_at timestamptz, created_at timestamptz not null default clock_timestamp())`,
  `create table if not exists idempotency_keys (
     team_id text not null, key text not null, version_id text not null, status integer not null, body text not null,
     created_at timestamptz not null default now(), primary key (team_id, key))`,
  `create table if not exists snapshots (
     id text primary key, version_id text not null references versions(id), manifest text not null,
     published_at timestamptz not null)`,
  `create table if not exists snapshot_pages (
     snapshot_id text not null references snapshots(id), page_id text not null, position integer not null,
     path text not null, title text not null, group_id text not null, group_title text not null, tab_id text not null,
     html text not null, body_text text not null, headings text not null, sig text not null, operation_id text,
     primary key (snapshot_id, page_id))`,
  `create table if not exists preview_links (
     id text primary key, page_id text not null references pages(id), token text not null unique,
     created_at timestamptz not null default now(), expires_at timestamptz not null, revoked boolean not null default false)`,
  `create table if not exists invites (
     id text primary key, team_id text not null references teams(id), inviter_id text not null references users(id),
     email text not null, role text not null, token text not null unique, status text not null,
     created_at timestamptz not null default now(), sent_at timestamptz, expires_at timestamptz not null)`,
  `create table if not exists votes (
     page_id text not null, reader text not null, vote text not null, primary key (page_id, reader))`,
  `create table if not exists search_records (
     id bigserial primary key, site_id text not null, version_id text not null, term text not null,
     results integer not null, created_at timestamptz not null default clock_timestamp())`,
  `create table if not exists openapi_imports (
     id text primary key, version_id text not null references versions(id), file_name text not null,
     bytes integer not null, sha256 text not null, s3_key text not null, document text not null, imported_at timestamptz not null default clock_timestamp())`,
  `create table if not exists assets (
     id text primary key, site_id text not null references sites(id), content_type text not null,
     created_at timestamptz not null default now())`,
];

export async function migrate(): Promise<void> {
  for (const statement of statements) {
    await db.query(statement);
  }
}
