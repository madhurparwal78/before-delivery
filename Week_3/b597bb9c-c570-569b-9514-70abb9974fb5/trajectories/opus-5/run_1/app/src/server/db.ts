import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function one<T extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows.length > 0 ? rows[0] : null;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForPostgres(): Promise<void> {
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const SCHEMA = `
create table if not exists people (
  id text primary key,
  name text not null,
  email text not null unique,
  handle text not null unique,
  password_hash text not null,
  availability text not null default '',
  is_owner boolean not null default false
);
create table if not exists sessions (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists workspace (
  id text primary key,
  owner_id text not null references people(id),
  opening_minutes integer not null default 0,
  opening_month text not null,
  carried_storage_bytes bigint not null default 0,
  seeded_at timestamptz not null default now()
);
create table if not exists projects (
  id text primary key,
  title text not null,
  agency text not null default '',
  description text not null default '',
  frame_rate text not null,
  aspect_ratio text not null,
  time_unit text not null default 'frames',
  version integer not null default 1,
  seed_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists project_rows (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  kind text not null,
  position integer not null,
  locked boolean not null default false
);
create index if not exists project_rows_project on project_rows(project_id);
create table if not exists clips (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  row_id text not null,
  name text not null,
  kind text not null,
  media_id text,
  start_frame integer not null default 0,
  end_frame integer not null default 0,
  source_in integer not null default 0,
  source_out integer not null default 0,
  speed_percent integer not null default 100,
  hidden boolean not null default false,
  group_id text,
  text text,
  text_colour text,
  box_colour text,
  font_weight integer,
  keyframes jsonb not null default '{}'::jsonb,
  base jsonb not null default '{"x":null,"y":null,"scale":null,"rotation":null,"opacity":null}'::jsonb,
  added_seq bigint not null default 0,
  start_seconds numeric,
  source_in_seconds numeric,
  source_out_seconds numeric
);
create index if not exists clips_project on clips(project_id);
create table if not exists captions (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  row_id text not null,
  start_frame integer not null default 0,
  end_frame integer not null default 0,
  text text not null,
  import_start_ms integer,
  import_end_ms integer,
  import_start_frame integer,
  import_end_frame integer,
  start_seconds numeric,
  end_seconds numeric
);
create index if not exists captions_project on captions(project_id);
create table if not exists caption_formats (
  row_id text primary key,
  line_ending text not null,
  byte_order_mark boolean not null default false
);
create table if not exists markers (
  id bigserial primary key,
  project_id text not null references projects(id) on delete cascade,
  frame integer not null default 0,
  label text not null default '',
  seconds numeric
);
create index if not exists markers_project on markers(project_id);
create table if not exists ops (
  project_id text not null references projects(id) on delete cascade,
  version integer not null,
  author_id text not null,
  type text not null,
  op jsonb not null,
  changes jsonb not null,
  removed jsonb not null default '[]'::jsonb,
  touched jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (project_id, version)
);
create table if not exists op_ids (
  project_id text not null,
  person_id text not null,
  op_id text not null,
  response jsonb not null,
  status integer not null default 200,
  created_at timestamptz not null default now(),
  primary key (project_id, person_id, op_id)
);
create table if not exists undo_entries (
  id bigserial primary key,
  project_id text not null references projects(id) on delete cascade,
  person_id text not null,
  forward jsonb not null,
  inverse jsonb not null,
  state text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists undo_entries_person on undo_entries(project_id, person_id, state, id);
create table if not exists members (
  project_id text not null references projects(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  role text not null,
  primary key (project_id, person_id)
);
create table if not exists cuts (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  version integer not null,
  total_frames integer not null,
  shared boolean not null default false,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists cuts_name on cuts(project_id, name);
create table if not exists cut_approvals (
  cut_id text not null references cuts(id) on delete cascade,
  name text not null,
  at timestamptz not null default now(),
  primary key (cut_id, name)
);
create table if not exists comments (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  author_person_id text,
  author_name text not null,
  body text not null,
  visibility text not null,
  parent_id text,
  cut_id text,
  pin_frame integer not null default 0,
  pin_row_id text,
  pin_clip_id text,
  mentions jsonb not null default '[]'::jsonb,
  pin_seconds numeric,
  created_at timestamptz not null default now()
);
create index if not exists comments_project on comments(project_id, created_at);
create table if not exists comment_drafts (
  project_id text not null references projects(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  draft jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, person_id)
);
create table if not exists review_links (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  token text not null unique,
  cut_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists read_tokens (
  id text primary key,
  name text not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create table if not exists kits (
  id text primary key,
  name text not null,
  text_colour text not null,
  box_colour text not null,
  font_weight integer not null,
  created_at timestamptz not null default now()
);
create table if not exists media (
  id text primary key,
  name text not null,
  kind text not null,
  folder text not null,
  bytes bigint not null,
  sha256 text not null unique,
  width integer,
  height integer,
  duration_seconds numeric(14,3),
  sample_rate integer,
  header jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists uploads (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  file_name text not null,
  folder text not null,
  bytes bigint not null,
  sha256 text not null,
  chunks integer not null,
  state text not null default 'open',
  replaces text,
  created_at timestamptz not null default now()
);
create index if not exists uploads_person on uploads(person_id, state);
create table if not exists upload_chunks (
  upload_id text not null references uploads(id) on delete cascade,
  n integer not null,
  bytes integer not null,
  primary key (upload_id, n)
);
create table if not exists exports (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  cut_id text not null,
  size integer not null,
  state text not null default 'queued',
  progress integer not null default 0,
  minutes integer not null default 0,
  requested_by text not null,
  requested_by_id text,
  manifest_checksum text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  finished_version integer
);
create index if not exists exports_project on exports(project_id, created_at desc);
create table if not exists outbox (
  id text primary key,
  to_addr text not null,
  subject text not null,
  body text not null,
  state text not null default 'waiting',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create table if not exists mention_notices (
  id bigserial primary key,
  person_id text not null references people(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  author_name text not null,
  frame integer not null default 0,
  body text not null,
  created_at timestamptz not null default now(),
  window_ends_at timestamptz not null,
  sent boolean not null default false
);
create table if not exists monthly_usage (
  month text primary key,
  rebuilt_at timestamptz not null default now()
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
