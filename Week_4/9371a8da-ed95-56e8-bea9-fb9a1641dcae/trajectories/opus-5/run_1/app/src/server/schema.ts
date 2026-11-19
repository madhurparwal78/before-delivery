export const SCHEMA_SQL = `
create table if not exists workspaces (
  id text primary key,
  name text not null
);

create table if not exists users (
  id text primary key,
  email text not null,
  email_lower text not null unique,
  display_name text not null,
  handle text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces(id),
  user_id text not null references users(id),
  role text not null,
  primary key (workspace_id, user_id)
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  workspace_id text not null references workspaces(id),
  title text not null,
  template text not null,
  project_revision integer not null,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  project_id text not null references projects(id),
  user_id text not null references users(id),
  role text not null,
  primary key (project_id, user_id)
);

create table if not exists files (
  id text primary key,
  project_id text not null references projects(id),
  kind text not null,
  path text not null,
  revision integer not null default 1,
  content text,
  size integer not null,
  sha256 text not null,
  content_type text,
  deleted boolean not null default false
);

create unique index if not exists files_live_path on files (project_id, path) where deleted = false;
create index if not exists files_project on files (project_id);

create table if not exists file_revisions (
  file_id text not null references files(id),
  revision integer not null,
  path text not null,
  content text,
  size integer not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  primary key (file_id, revision)
);

create table if not exists revision_files (
  project_id text not null references projects(id),
  project_revision integer not null,
  file_id text not null references files(id),
  path text not null,
  kind text not null,
  file_revision integer not null,
  size integer not null,
  sha256 text not null,
  primary key (project_id, project_revision, file_id)
);

create table if not exists ledger_entries (
  project_id text not null references projects(id),
  project_revision integer not null,
  kind text not null,
  summary text not null,
  actor_id text not null,
  actor_display_name text not null,
  actor_handle text not null,
  at timestamptz not null default now(),
  primary key (project_id, project_revision)
);

create table if not exists labels (
  id text primary key,
  project_id text not null references projects(id),
  name text not null,
  name_lower text not null,
  project_revision integer not null,
  created_at timestamptz not null default now(),
  actor_id text not null,
  actor_display_name text not null,
  actor_handle text not null
);

create unique index if not exists labels_name_unique on labels (project_id, name_lower);

create table if not exists suggestions (
  id text primary key,
  project_id text not null references projects(id),
  file_id text not null references files(id),
  from_pos integer,
  to_pos integer,
  deleted_text text not null,
  inserted text not null,
  status text not null,
  author_id text not null references users(id),
  created_at timestamptz not null default now(),
  resolved_by text references users(id),
  resolved_at timestamptz,
  orphaned_at timestamptz
);

create index if not exists suggestions_project on suggestions (project_id);

create table if not exists threads (
  id text primary key,
  project_id text not null references projects(id),
  file_id text not null references files(id),
  from_pos integer,
  to_pos integer,
  quote text not null,
  status text not null,
  orphaned_at timestamptz,
  resolved_by text references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists threads_project on threads (project_id);

create table if not exists comments (
  id text primary key,
  thread_id text not null references threads(id),
  author_id text not null references users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_thread on comments (thread_id);

create table if not exists citation_reports (
  project_id text not null references projects(id),
  project_revision integer not null,
  check_id text not null,
  lists jsonb not null,
  primary key (project_id, project_revision)
);

create table if not exists save_answers (
  user_id text not null references users(id),
  file_id text not null references files(id),
  idempotency_key text not null,
  content_hash text not null,
  base_revision integer not null,
  http_status integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, file_id, idempotency_key)
);

create table if not exists invites (
  id text primary key,
  project_id text not null references projects(id),
  token text not null unique,
  email text not null,
  email_lower text not null,
  role text not null,
  status text not null,
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  inviter_id text not null references users(id),
  inviter_name text not null
);

create index if not exists invites_project on invites (project_id);

create table if not exists share_links (
  project_id text primary key references projects(id),
  token text not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists exports (
  id text primary key,
  project_id text not null references projects(id),
  project_revision integer not null,
  size integer not null,
  sha256 text not null,
  object_key text not null,
  filename text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists exports_revision on exports (project_id, project_revision);

create table if not exists mention_emails (
  id text primary key,
  comment_id text not null references comments(id),
  project_id text not null references projects(id),
  thread_id text not null references threads(id),
  recipient_id text not null references users(id),
  status text not null,
  created_at timestamptz not null,
  due_at timestamptz not null,
  claimed_at timestamptz
);

create index if not exists mention_emails_due on mention_emails (status, due_at);
`;
