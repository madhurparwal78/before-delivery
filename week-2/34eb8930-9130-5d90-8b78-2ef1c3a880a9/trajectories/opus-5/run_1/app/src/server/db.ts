import pg from 'pg';
import { env } from './env.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values);
}

const SCHEMA = `
create table if not exists people (
  id text primary key,
  display_name text not null,
  email text not null unique,
  password_hash text not null,
  colour text not null,
  is_consultant boolean not null default false
);

create table if not exists sessions (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists documents (
  id text primary key,
  title text not null,
  client text not null,
  owner_id text not null references people(id),
  revision integer not null default 0,
  origin_revision integer not null default 0,
  saved_revision integer not null default 0,
  save_failed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shares (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  email text not null,
  role text not null,
  ends_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists shares_document_idx on shares(document_id);
create index if not exists shares_person_idx on shares(person_id);

create table if not exists operations (
  document_id text not null references documents(id) on delete cascade,
  revision integer not null,
  author_id text not null,
  mode text not null,
  ops jsonb not null,
  created_at timestamptz not null default now(),
  primary key (document_id, revision)
);

create table if not exists suggestions (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  author_id text not null references people(id),
  kind text not null,
  inserted_at integer,
  inserted_length integer,
  deleted_at integer,
  deleted_length integer,
  content_deleted boolean not null default false,
  status text not null default 'open',
  decided_by text references people(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists suggestions_document_idx on suggestions(document_id);

create table if not exists comments (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  parent_id text references comments(id) on delete cascade,
  author_id text not null references people(id),
  body text not null,
  anchor_at integer,
  anchor_length integer,
  content_deleted boolean not null default false,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists comments_document_idx on comments(document_id);

create table if not exists comment_mentions (
  comment_id text not null references comments(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  primary key (comment_id, person_id)
);

create table if not exists document_modes (
  document_id text not null references documents(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  mode text not null,
  primary key (document_id, person_id)
);

create table if not exists recents (
  document_id text not null references documents(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (document_id, person_id)
);

create table if not exists notices (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  kind text not null,
  document_id text not null references documents(id) on delete cascade,
  actor_id text not null references people(id) on delete cascade,
  role text,
  comment_id text,
  text text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notices_person_idx on notices(person_id);

create table if not exists presence (
  document_id text not null references documents(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  state text not null,
  last_input_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (document_id, person_id)
);
`;

export async function applySchema(): Promise<void> {
  await query(SCHEMA);
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await query('select 1');
    return true;
  } catch {
    return false;
  }
}
