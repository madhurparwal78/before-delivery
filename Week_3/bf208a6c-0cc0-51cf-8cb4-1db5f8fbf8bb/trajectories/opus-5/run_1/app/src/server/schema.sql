create table if not exists users (
  id uuid primary key,
  display_name text not null,
  email text not null unique,
  password_hash text not null,
  verified boolean not null default false,
  verify_code text,
  verify_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists boards (
  id uuid primary key,
  owner_id uuid not null references users (id) on delete cascade,
  title text not null,
  layout text not null default 'columns',
  sort text not null default 'by_hand',
  grouping text not null default 'section',
  privacy text not null default 'private',
  password_hash text,
  approval boolean not null default false,
  link_access text not null default 'off',
  link_token text unique,
  unlock_generation integer not null default 1,
  created_at timestamptz not null default now(),
  seq bigserial
);

create table if not exists sections (
  id uuid primary key,
  board_id uuid not null references boards (id) on delete cascade,
  title text not null,
  ord integer not null
);

create table if not exists memberships (
  board_id uuid not null references boards (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists posts (
  id uuid primary key,
  board_id uuid not null references boards (id) on delete cascade,
  section_id uuid not null references sections (id) on delete cascade,
  author_id uuid not null references users (id) on delete cascade,
  title text not null,
  body text not null default '',
  state text not null default 'published',
  position integer,
  version integer not null default 1,
  push_state text,
  last_actor_id uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  seq bigserial
);

create table if not exists attachments (
  id uuid primary key,
  post_id uuid not null references posts (id) on delete cascade,
  board_id uuid not null references boards (id) on delete cascade,
  file_name text not null,
  content_type text not null,
  size integer not null,
  object_key text not null
);

create table if not exists likes (
  post_id uuid not null references posts (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists votes (
  post_id uuid not null references posts (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  value smallint not null,
  primary key (post_id, user_id)
);

create table if not exists comments (
  id uuid primary key,
  post_id uuid not null references posts (id) on delete cascade,
  author_id uuid not null references users (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  seq bigserial
);

create table if not exists invites (
  id uuid primary key,
  board_id uuid not null references boards (id) on delete cascade,
  token text not null unique,
  email text not null,
  role text not null,
  inviter_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists events (
  id bigserial primary key,
  board_id uuid not null references boards (id) on delete cascade,
  data jsonb not null,
  visibility text not null default 'all',
  subject_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists object_cleanups (
  id bigserial primary key,
  prefix text not null,
  created_at timestamptz not null default now()
);

create index if not exists posts_board_idx on posts (board_id, section_id, state, position);
create index if not exists posts_seq_idx on posts (board_id, seq);
create index if not exists events_board_idx on events (board_id, id);
create index if not exists comments_post_idx on comments (post_id, seq);
create index if not exists attachments_post_idx on attachments (post_id);
create index if not exists memberships_user_idx on memberships (user_id);
