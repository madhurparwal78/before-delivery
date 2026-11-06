import { db, pool, type Queryable } from './db.js';
import { seedDatabase } from './seed.js';

const ddl = `
create table if not exists workspaces (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  seats_limit integer not null,
  seats_confirmed_at timestamptz,
  scheduled_limit integer,
  scheduled_on date,
  event_seq bigint not null default 0,
  created_at timestamptz not null
);

create table if not exists calendars (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  effective_date date not null,
  time_zone text not null,
  working_weekdays integer[] not null,
  holidays jsonb not null,
  cycle_anchor date not null,
  created_at timestamptz not null
);
create index if not exists calendars_lookup on calendars (workspace_id, effective_date desc, id desc);

create table if not exists people (
  id uuid primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,
  email text not null,
  email_lower text not null unique,
  handle text,
  role text,
  password_hash text not null,
  removed boolean not null default false,
  away boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null
);
create index if not exists people_workspace on people (workspace_id);

create table if not exists sessions (
  token_hash text primary key,
  person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists sessions_person on sessions (person_id);

create table if not exists projects (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key text not null,
  name text not null,
  next_issue_number integer not null default 1
);
create index if not exists projects_workspace on projects (workspace_id);

create table if not exists project_guests (
  project_id uuid not null references projects(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  primary key (project_id, person_id)
);

create table if not exists issues (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  number integer not null,
  key text not null,
  title text not null,
  description text not null default '',
  status text not null,
  assignee_id uuid references people(id),
  parent_id uuid references issues(id),
  cycle_number integer,
  due_date date,
  closed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (workspace_id, key),
  unique (project_id, number)
);
create index if not exists issues_project on issues (project_id);

create table if not exists channels (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null
);
create index if not exists channels_workspace on channels (workspace_id);

create table if not exists channel_members (
  channel_id uuid not null references channels(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  joined_at timestamptz not null,
  primary key (channel_id, person_id)
);
create index if not exists channel_members_person on channel_members (person_id);

create sequence if not exists message_ids as bigint;

create table if not exists messages (
  id bigint primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  author_id uuid not null references people(id) on delete cascade,
  body text not null,
  thread_root_id bigint,
  mentions uuid[] not null default '{}',
  client_key text,
  created_at timestamptz not null,
  deleted boolean not null default false
);
create index if not exists messages_channel on messages (channel_id, id);
create index if not exists messages_thread on messages (thread_root_id);

create table if not exists read_markers (
  person_id uuid not null references people(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  thread_root_id bigint not null default 0,
  up_to bigint not null,
  primary key (person_id, channel_id, thread_root_id)
);

create table if not exists typing (
  person_id uuid not null references people(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  last_at timestamptz not null,
  primary key (person_id, channel_id)
);

create table if not exists docs (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  body text not null,
  version integer not null,
  updated_by uuid references people(id),
  updated_at timestamptz not null,
  created_at timestamptz not null
);
create index if not exists docs_workspace on docs (workspace_id);

create table if not exists doc_versions (
  doc_id uuid not null references docs(id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  saved_by uuid references people(id),
  saved_at timestamptz not null,
  primary key (doc_id, version)
);

create table if not exists rooms (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  kind text not null,
  x integer not null,
  y integer not null,
  w integer not null,
  h integer not null,
  sort integer not null
);
create index if not exists rooms_workspace on rooms (workspace_id);

create table if not exists room_occupants (
  person_id uuid primary key references people(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  joined_at timestamptz not null
);
create index if not exists room_occupants_room on room_occupants (room_id);

create table if not exists knocks (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  status text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);
create index if not exists knocks_room on knocks (room_id, status);
create index if not exists knocks_person on knocks (person_id, room_id);

create table if not exists invites (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  email_lower text not null,
  role text not null,
  project_ids uuid[] not null default '{}',
  channel_ids uuid[] not null default '{}',
  status text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  invited_by uuid references people(id)
);
create index if not exists invites_email on invites (email_lower);
create index if not exists invites_workspace on invites (workspace_id);

create table if not exists attachments (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_type text not null,
  parent_id text not null,
  filename text not null,
  size bigint not null,
  content_type text not null,
  object_key text not null,
  created_at timestamptz not null,
  uploaded_by uuid references people(id)
);
create index if not exists attachments_parent on attachments (parent_type, parent_id);

create table if not exists idempotency (
  person_id uuid not null references people(id) on delete cascade,
  endpoint text not null,
  key text not null,
  body_hash text not null,
  status integer,
  response jsonb,
  created_at timestamptz not null,
  primary key (person_id, endpoint, key)
);

create table if not exists outbox (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  kind text not null,
  invite_id uuid,
  message_id bigint,
  person_id uuid,
  channel_id uuid,
  digest_date date,
  created_at timestamptz not null,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz
);
create index if not exists outbox_pending on outbox (sent_at, claimed_at);

create table if not exists attachment_deletions (
  id bigserial primary key,
  object_key text not null,
  created_at timestamptz not null,
  done_at timestamptz,
  claimed_at timestamptz
);
create index if not exists attachment_deletions_pending on attachment_deletions (done_at);

create table if not exists events (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  id bigint not null,
  name text not null,
  payload jsonb not null,
  scope_type text not null,
  scope_id text,
  created_at timestamptz not null,
  primary key (workspace_id, id)
);

create table if not exists cycle_records (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  number integer not null,
  record jsonb not null,
  created_at timestamptz not null,
  primary key (workspace_id, number)
);

create table if not exists digests (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  digest_date date not null,
  primary key (workspace_id, person_id, digest_date)
);

create table if not exists streams (
  id uuid primary key,
  person_id uuid not null references people(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  opened_at timestamptz not null,
  last_seen_at timestamptz not null,
  closed_at timestamptz
);
create index if not exists streams_person on streams (person_id, closed_at);
`;

let ready = false;

export function schemaReady(): boolean {
  return ready;
}

/** Applies the schema and loads the seed, once per database, however many copies start together. */
export async function applySchemaAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(5713241)');
    const scoped: Queryable = {
      async query(sql, params = []) {
        const result = await client.query(sql, params as unknown[]);
        return result.rows as never;
      },
      async one(sql, params = []) {
        const result = await client.query(sql, params as unknown[]);
        return result.rows[0] as never;
      },
    };
    await scoped.query(ddl);
    const existing = await scoped.one<{ count: number }>('select count(*)::int as count from workspaces');
    if ((existing?.count ?? 0) === 0) await seedDatabase(scoped);
    ready = true;
  } finally {
    try {
      await client.query('select pg_advisory_unlock(5713241)');
    } finally {
      client.release();
    }
  }
  await db.query('select 1');
}
