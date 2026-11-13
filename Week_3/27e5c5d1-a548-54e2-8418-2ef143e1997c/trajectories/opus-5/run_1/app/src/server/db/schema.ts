export const SCHEMA_SQL = `
create table if not exists users (
  id text primary key,
  display_name text not null,
  email text not null unique,
  password_hash text not null,
  phone text not null default '',
  colour text not null,
  initials text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id text primary key,
  name text not null,
  parent_name text not null,
  time_zone text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null,
  joined_seq bigserial,
  primary key (workspace_id, user_id)
);

create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id);

create table if not exists boards (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  visibility text not null,
  created_at timestamptz not null default now()
);

create index if not exists boards_workspace_idx on boards (workspace_id);

create table if not exists board_members (
  board_id text not null references boards(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  state text not null,
  primary key (board_id, user_id)
);

create table if not exists lists (
  id text primary key,
  board_id text not null references boards(id) on delete cascade,
  name text not null,
  position integer not null
);

create index if not exists lists_board_idx on lists (board_id, position);

create table if not exists cards (
  id text primary key,
  board_id text not null references boards(id) on delete cascade,
  list_id text not null references lists(id) on delete cascade,
  title text not null,
  notes text not null default '',
  due_date date,
  labels text[] not null default '{}',
  status text not null default 'open',
  version integer not null default 1,
  owner_user_id text references users(id) on delete set null,
  position integer,
  archived_at timestamptz,
  last_change text not null default 'edited',
  last_changed_by text references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists cards_list_idx on cards (list_id, position);
create index if not exists cards_board_idx on cards (board_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cards_dense_position') then
    alter table cards add constraint cards_dense_position unique (list_id, position) deferrable initially deferred;
  end if;
exception when duplicate_table or duplicate_object then
  null;
end $$;

create table if not exists card_private_members (
  card_id text not null references cards(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  primary key (card_id, user_id)
);

create table if not exists checklist_items (
  id text primary key,
  card_id text not null references cards(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  position integer not null
);

create index if not exists checklist_card_idx on checklist_items (card_id, position);

create table if not exists attachments (
  id text primary key,
  card_id text not null references cards(id) on delete cascade,
  workspace_id text not null,
  filename text not null,
  content_type text not null,
  size bigint not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by_user_id text not null references users(id) on delete cascade
);

create index if not exists attachments_card_idx on attachments (card_id, uploaded_at);

create table if not exists idempotency_keys (
  user_id text not null references users(id) on delete cascade,
  key text not null,
  list_id text not null,
  title text not null,
  response jsonb,
  primary key (user_id, key)
);

create table if not exists permission_log (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  at timestamptz not null default now(),
  actor_user_id text not null references users(id) on delete cascade,
  action text not null,
  target_type text not null,
  target_id text not null,
  target_label text not null,
  board_id text,
  before_value jsonb,
  after_value jsonb,
  seq bigserial
);

create index if not exists permission_log_workspace_idx on permission_log (workspace_id, at desc, seq desc);
`;
