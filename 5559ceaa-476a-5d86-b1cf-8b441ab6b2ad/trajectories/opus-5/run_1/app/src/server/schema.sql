create table if not exists users (
  id uuid primary key,
  email text unique,
  name text not null,
  kind text not null,
  created_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key,
  title text not null,
  kind text not null,
  owner_id uuid not null references users(id) on delete cascade,
  file_seq bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  email_status text not null default 'none',
  seq bigserial,
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists signin_tokens (
  token text primary key,
  email text not null,
  invite_name text,
  project_id uuid references projects(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists invites (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  name text not null,
  email_status text not null,
  created_at timestamptz not null default now()
);

create table if not exists project_sessions (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  state text not null,
  scheduled_for timestamptz not null,
  driver_id uuid references users(id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists files (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  content bytea not null,
  revision integer not null,
  sha256 text not null,
  size integer not null,
  created_at timestamptz not null default now(),
  unique (project_id, path)
);

create table if not exists edit_log (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  file_id uuid not null,
  user_id uuid references users(id) on delete set null,
  actor_name text not null,
  revision integer not null,
  sha256 text not null,
  at timestamptz not null default now()
);

create table if not exists checkpoints (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  state text not null,
  created_by uuid references users(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz
);

create table if not exists checkpoint_files (
  checkpoint_id uuid not null references checkpoints(id) on delete cascade,
  file_id uuid not null,
  path text not null,
  sha256 text not null,
  size integer not null,
  staged bytea,
  primary key (checkpoint_id, file_id)
);

create table if not exists restores (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  checkpoint_id uuid not null references checkpoints(id) on delete cascade,
  state text not null,
  file_seq_after bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists restore_files (
  restore_id uuid not null references restores(id) on delete cascade,
  file_id uuid not null,
  path text not null,
  content bytea not null,
  revision integer not null,
  sha256 text not null,
  size integer not null,
  primary key (restore_id, file_id)
);

create table if not exists import_plans (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  state text not null,
  entries jsonb not null,
  only_in_project jsonb not null,
  ignored jsonb not null,
  expires_at timestamptz not null,
  quarantine_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists reviewer_links (
  id uuid primary key,
  checkpoint_id uuid not null references checkpoints(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  email_status text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  type text not null,
  actor_id uuid references users(id) on delete set null,
  actor_name text not null,
  subject jsonb not null,
  at timestamptz not null default now()
);

create table if not exists idempotency_records (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  body_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists outbox (
  id uuid primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  state text not null,
  recipient_user_id uuid references users(id) on delete set null,
  invite_id uuid,
  member_project_id uuid,
  member_user_id uuid,
  link_id uuid,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists presence (
  connection_id text primary key,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  instance_id text not null,
  last_seen timestamptz not null default now()
);

create index if not exists files_project_idx on files (project_id);
create index if not exists checkpoints_project_idx on checkpoints (project_id, created_at desc);
create index if not exists audit_project_idx on audit_events (project_id, at desc);
create index if not exists presence_project_idx on presence (project_id);
create index if not exists outbox_pending_idx on outbox (state, next_attempt_at);
create index if not exists checkpoints_pending_idx on checkpoints (state, next_attempt_at);
create index if not exists import_plans_sweep_idx on import_plans (state, expires_at);
