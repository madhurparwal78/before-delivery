create table if not exists users (
  id text primary key,
  username text not null unique,
  pw_hash text not null,
  created_at timestamptz not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  expired_sent boolean not null default false
);

create table if not exists guests (
  id text primary key,
  map_id text not null,
  link_id text not null,
  display_name text not null,
  role text not null,
  created_at timestamptz not null
);

create table if not exists maps (
  id text primary key,
  title text not null,
  owner_id text not null references users(id) on delete cascade,
  doc jsonb not null,
  revision integer not null,
  live_seq bigint not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists members (
  map_id text not null references maps(id) on delete cascade,
  username text not null,
  role text not null,
  primary key (map_id, username)
);

create table if not exists op_groups (
  map_id text not null references maps(id) on delete cascade,
  group_id text not null,
  seq bigserial,
  actor text not null,
  actor_name text not null,
  base_revision integer not null,
  revision integer not null,
  ops jsonb not null,
  response jsonb not null,
  sentence text not null,
  topic_id text,
  events jsonb not null default '[]',
  touched jsonb not null default '[]',
  at timestamptz not null,
  primary key (map_id, group_id)
);

create table if not exists op_ids (
  map_id text not null references maps(id) on delete cascade,
  op_id text not null,
  group_id text not null,
  primary key (map_id, op_id)
);

create table if not exists live_messages (
  map_id text not null references maps(id) on delete cascade,
  seq bigint not null,
  payload jsonb not null,
  recipient text,
  primary key (map_id, seq)
);

create table if not exists collapse_state (
  map_id text not null references maps(id) on delete cascade,
  actor text not null,
  topic_id text not null,
  primary key (map_id, actor, topic_id)
);

create table if not exists undo_stacks (
  map_id text not null references maps(id) on delete cascade,
  actor text not null,
  kind text not null,
  entries jsonb not null,
  primary key (map_id, actor, kind)
);

create table if not exists recovered_edits (
  id text primary key,
  map_id text not null references maps(id) on delete cascade,
  actor text not null,
  entry jsonb not null,
  created_at timestamptz not null
);

create table if not exists comments (
  id text not null,
  map_id text not null references maps(id) on delete cascade,
  topic_id text not null,
  author text not null,
  body text not null,
  resolved boolean not null default false,
  reply_to text,
  created_at timestamptz not null,
  primary key (map_id, id)
);

create table if not exists votes (
  map_id text not null references maps(id) on delete cascade,
  topic_id text not null,
  actor text not null,
  primary key (map_id, topic_id, actor)
);

create table if not exists mentions (
  id text primary key,
  map_id text not null references maps(id) on delete cascade,
  topic_id text not null,
  comment_id text not null,
  username text not null,
  by_user text not null,
  read boolean not null default false,
  created_at timestamptz not null
);

create table if not exists versions (
  id text primary key,
  map_id text not null references maps(id) on delete cascade,
  number integer not null,
  name text not null,
  kind text not null,
  by_user text not null,
  revision integer not null,
  created_at timestamptz not null
);

create table if not exists version_baselines (
  map_id text primary key references maps(id) on delete cascade,
  baseline timestamptz not null,
  last_revision integer not null
);

create table if not exists share_links (
  id text primary key,
  map_id text not null references maps(id) on delete cascade,
  code text not null unique,
  role text not null,
  expires_at timestamptz,
  state text not null,
  created_at timestamptz not null
);

create table if not exists presentations (
  id text primary key,
  map_id text not null references maps(id) on delete cascade,
  code text not null unique,
  state text not null,
  slide_index integer not null default 0,
  presenter text not null,
  created_at timestamptz not null,
  disconnected_at timestamptz
);

create table if not exists export_jobs (
  id text primary key,
  map_id text not null references maps(id) on delete cascade,
  actor text not null,
  format text not null,
  topic_id text,
  state text not null,
  progress integer not null,
  next_step_at timestamptz,
  created_at timestamptz not null
);

create table if not exists attachments (
  id text primary key,
  map_id text not null references maps(id) on delete cascade,
  topic_id text not null,
  sha256 text not null,
  bytes integer not null,
  type text not null,
  state text not null,
  created_at timestamptz not null
);

create table if not exists outline_imports (
  id text primary key,
  map_id text not null references maps(id) on delete cascade,
  sha256 text not null,
  bytes integer not null,
  nodes jsonb not null,
  created_at timestamptz not null
);

create table if not exists clipboards (
  actor text primary key,
  payload jsonb not null,
  updated_at timestamptz not null
);

create table if not exists login_attempts (
  username text not null,
  at timestamptz not null
);

create table if not exists op_attempts (
  actor text not null,
  at timestamptz not null,
  weight integer not null
);

create index if not exists comments_topic_idx on comments (map_id, topic_id);
create index if not exists votes_topic_idx on votes (map_id, topic_id);
create index if not exists mentions_user_idx on mentions (username, read);
create index if not exists live_seq_idx on live_messages (map_id, seq);
create index if not exists op_groups_seq_idx on op_groups (map_id, seq);
create index if not exists login_attempts_idx on login_attempts (username, at);
create index if not exists op_attempts_idx on op_attempts (actor, at);
