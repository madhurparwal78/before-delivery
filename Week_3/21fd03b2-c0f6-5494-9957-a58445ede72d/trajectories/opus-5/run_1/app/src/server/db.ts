import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', () => {
  /* a broken idle client is replaced on the next checkout */
});

export type Run = <R>(text: string, values?: unknown[]) => Promise<R[]>;

export async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, values);
  return result.rows as T[];
}

export async function one<T>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows.length > 0 ? rows[0] : null;
}

export async function transaction<T>(work: (run: Run) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(async <R>(text: string, values: unknown[] = []) => {
      const rows = await client.query(text, values);
      return rows.rows as R[];
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists accounts (
  id text primary key,
  email text not null,
  email_folded text not null unique,
  display_name text not null,
  password_hash text not null,
  last_workspace_id text,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,
  user_id text not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists workspaces (
  id text primary key,
  name text not null,
  owner_id text not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists memberships (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references accounts(id) on delete cascade,
  role text not null,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create table if not exists invites (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  inviter_id text not null references accounts(id) on delete cascade,
  email text not null,
  email_folded text not null,
  role text not null,
  status text not null,
  reason text,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create unique index if not exists invites_one_pending
  on invites (workspace_id, email_folded) where status = 'pending';
create table if not exists projects (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists scenes (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  status text not null,
  revision integer not null,
  state_hash text not null,
  document text not null,
  restore_revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists revisions (
  scene_id text not null references scenes(id) on delete cascade,
  revision integer not null,
  document text not null,
  ops jsonb not null,
  changed_keys text[] not null,
  change_id text,
  request_sha256 text,
  state_hash text not null,
  created_at timestamptz not null default now(),
  primary key (scene_id, revision)
);
create unique index if not exists revisions_change_id
  on revisions (scene_id, change_id) where change_id is not null;
create table if not exists checkpoints (
  id text primary key,
  scene_id text not null references scenes(id) on delete cascade,
  label text not null,
  label_folded text not null,
  revision integer not null,
  state_hash text not null,
  document_sha256 text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists checkpoints_label
  on checkpoints (scene_id, label_folded);
create table if not exists assets (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  kind text not null,
  bytes integer not null,
  sha256 text not null,
  unit text,
  scale_to_metres double precision,
  extent_metres double precision,
  created_at timestamptz not null default now()
);
create unique index if not exists assets_project_sha on assets (project_id, sha256);
create table if not exists activity (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  actor_id text not null references accounts(id) on delete cascade,
  action text not null,
  target_name text not null,
  at timestamptz not null default now()
);
create index if not exists activity_page on activity (workspace_id, at desc, id desc);
create table if not exists share_links (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  token text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists labs (
  scene_id text primary key references scenes(id) on delete cascade,
  token text not null unique,
  bundle_hash text not null,
  published_at timestamptz not null,
  checkpoint_id text not null,
  exposed jsonb not null,
  active boolean not null default true
);
create table if not exists outbox (
  id text primary key,
  kind text not null,
  recipient text not null,
  subject text not null,
  body text not null,
  ref_id text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  dropped_at timestamptz,
  attempts integer not null default 0
);
create index if not exists outbox_queue on outbox (created_at) where sent_at is null;
create table if not exists seed_marker (
  id text primary key
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
