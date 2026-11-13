package store

const schemaSQL = `
create table if not exists users (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null,
  created_at timestamptz not null
);

create table if not exists projects (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  client text not null,
  source_language text not null,
  target_languages text[] not null,
  repository text not null,
  mqm_threshold int not null,
  ai_routes jsonb not null,
  created_at timestamptz not null,
  change_seq bigint not null default 0
);

create table if not exists reviewer_scopes (
  user_id uuid not null references users(id) on delete cascade,
  project_id uuid not null,
  primary key (user_id, project_id)
);

create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists branches (
  id uuid primary key,
  project_id uuid not null,
  name text not null,
  state text not null,
  is_main boolean not null,
  base jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  unique (project_id, name)
);

create table if not exists keys (
  id uuid primary key,
  project_id uuid not null,
  branch_id uuid not null,
  key_id uuid not null,
  name text not null,
  source text not null,
  deleted boolean not null default false,
  unique (branch_id, key_id)
);
create index if not exists keys_branch_idx on keys (branch_id);

create table if not exists segments (
  id uuid primary key,
  project_id uuid not null,
  branch_id uuid not null,
  key_id uuid not null,
  language text not null,
  value text,
  status text not null,
  score int,
  origin text,
  unique (branch_id, key_id, language)
);
create index if not exists segments_branch_idx on segments (branch_id);

create table if not exists segment_issues (
  id uuid primary key,
  segment_id uuid not null,
  ord int not null,
  category text not null,
  severity text not null,
  note text not null default ''
);
create index if not exists segment_issues_segment_idx on segment_issues (segment_id);

create table if not exists segment_comments (
  id uuid primary key,
  segment_id uuid not null,
  author text not null,
  body text not null,
  at timestamptz not null
);
create index if not exists segment_comments_segment_idx on segment_comments (segment_id);

create table if not exists segment_history (
  id bigserial primary key,
  segment_id uuid not null,
  at timestamptz not null,
  actor text not null,
  from_status text not null default '',
  to_status text not null default '',
  value text
);
create index if not exists segment_history_segment_idx on segment_history (segment_id);

create table if not exists key_history (
  id bigserial primary key,
  project_id uuid not null,
  key_id uuid not null,
  at timestamptz not null,
  branch text not null,
  field text not null,
  from_value text,
  to_value text,
  actor text not null
);
create index if not exists key_history_key_idx on key_history (key_id);

create table if not exists tm_entries (
  id uuid primary key,
  project_id uuid not null,
  target_language text not null,
  source text not null,
  target text not null,
  norm_source text not null,
  norm_target text not null,
  note text not null default '',
  import_id uuid,
  created_at timestamptz not null,
  seq bigserial,
  unique (project_id, target_language, norm_source, norm_target)
);
create index if not exists tm_entries_project_idx on tm_entries (project_id);

create table if not exists tm_imports (
  id uuid primary key,
  project_id uuid not null,
  filename text not null,
  format text not null,
  size bigint not null,
  sha256 text not null,
  object_key text not null,
  added int not null,
  duplicates int not null,
  applied int not null,
  report jsonb not null,
  at timestamptz not null,
  restored_at timestamptz
);

create table if not exists source_files (
  id uuid primary key,
  project_id uuid not null,
  branch text not null,
  filename text not null,
  content_type text not null,
  size bigint not null,
  sha256 text not null,
  object_key text not null,
  at timestamptz not null
);

create table if not exists operations (
  id uuid primary key,
  project_id uuid not null,
  kind text not null,
  label text not null,
  branch text not null default '',
  at timestamptz not null,
  restored_at timestamptz,
  snapshot_key text not null,
  seq_after bigint not null
);

create table if not exists resolutions (
  branch_id uuid not null,
  conflict_id text not null,
  choice text not null,
  value text,
  by_actor text not null,
  at timestamptz not null,
  main_seen text,
  primary key (branch_id, conflict_id)
);

create table if not exists holds (
  branch_id uuid not null,
  conflict_id text not null,
  session_id text not null,
  held_until timestamptz not null,
  primary key (branch_id, conflict_id)
);

create table if not exists assignments (
  id uuid primary key,
  project_id uuid not null,
  reviewer_id uuid not null,
  branch text not null,
  language text not null,
  segment_ids uuid[] not null,
  state text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null
);

create table if not exists tokens (
  id uuid primary key,
  project_id uuid not null,
  label text not null,
  token_hash text not null,
  created_at timestamptz not null
);

create table if not exists webhooks (
  project_id uuid primary key,
  url text not null,
  signing_secret text not null,
  app_uid text not null,
  endpoint_id text not null
);

create table if not exists events (
  id uuid primary key,
  project_id uuid,
  event_id text not null unique,
  type text not null,
  payload jsonb not null,
  url text not null default '',
  app_uid text not null default '',
  state text not null,
  attempts int not null default 0,
  created_at timestamptz not null,
  sent_at timestamptz
);

create table if not exists idempotency (
  project_id uuid not null,
  key text not null,
  body_hash text not null,
  status int not null,
  response jsonb not null,
  created_at timestamptz not null,
  primary key (project_id, key)
);

create table if not exists publishes (
  id uuid primary key,
  project_id uuid not null,
  branch text not null,
  state text not null,
  failure_reason text,
  languages text[] not null,
  pr_number int,
  pr_url text,
  bundles jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  confirmed_at timestamptz
);

create table if not exists audit (
  id uuid primary key,
  at timestamptz not null,
  actor text not null,
  action text not null,
  project text not null,
  detail text not null,
  project_id uuid
);

create table if not exists svix_app_deletions (
  app_uid text primary key,
  queued_at timestamptz not null
);
`
