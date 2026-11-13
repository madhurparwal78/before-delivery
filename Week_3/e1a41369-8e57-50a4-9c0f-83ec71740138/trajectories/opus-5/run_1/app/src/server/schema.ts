export const SCHEMA_SQL = `
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  time_zone text not null default 'UTC',
  day_start_hour int not null default 0,
  level int not null default 1,
  experience int not null default 0,
  health_tenths int not null default 500,
  resting boolean not null default false,
  open_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  difficulty text,
  value int,
  streak int,
  done boolean,
  weekdays text[],
  price_cents int,
  position int not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists tasks_owner on tasks (user_id, type, position);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  text text not null,
  checked boolean not null default false,
  position int not null
);
create index if not exists checklist_task on checklist_items (task_id, position);

create table if not exists gold_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  amount_cents int not null,
  task_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists ledger_owner on gold_ledger (user_id, seq);

create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  level int not null,
  gold_lost_cents int not null default 0,
  acked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notices_owner on notices (user_id, acked, seq);

create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  leader_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists party_members (
  party_id uuid not null references parties(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);
create unique index if not exists party_members_one_party on party_members (user_id);

create table if not exists party_invites (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (party_id, user_id)
);

create table if not exists quests (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id) on delete cascade,
  name text not null,
  boss text not null,
  max_health_tenths int not null,
  boss_health_tenths int not null,
  power_tenths int not null,
  reward_gold_cents int not null,
  reward_experience int not null,
  state text not null,
  invited_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  defeated_by uuid references users(id) on delete set null
);
create index if not exists quests_party on quests (party_id, state);

create table if not exists quest_responses (
  quest_id uuid not null references quests(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  accepted boolean not null,
  primary key (quest_id, user_id)
);

create table if not exists quest_participants (
  quest_id uuid not null references quests(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (quest_id, user_id)
);

create table if not exists strike_events (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references quests(id) on delete cascade,
  seq int not null,
  kind text not null,
  user_id uuid not null references users(id) on delete cascade,
  amount_tenths int not null,
  missed int,
  boss_health_after_tenths int not null,
  created_at timestamptz not null default now(),
  unique (quest_id, seq)
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,
  party_id uuid not null references parties(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_party on chat_messages (party_id, seq);

create table if not exists ticks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  experience int not null,
  gold_cents int not null,
  damage_tenths int not null,
  quest_id uuid references quests(id) on delete set null,
  strike_event_id uuid,
  prev_level int not null,
  prev_experience int not null,
  prev_health_tenths int not null,
  caused_level_up boolean not null,
  open boolean not null default true
);
create index if not exists ticks_task on ticks (task_id, open);

create table if not exists idempotency_records (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  method text not null,
  path text not null,
  body_hash text not null,
  status int not null,
  response text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists closed_days (
  user_id uuid not null references users(id) on delete cascade,
  local_date date not null,
  closed_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

create table if not exists imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  filename text not null,
  size int not null,
  status text not null,
  object_key text not null,
  created_at timestamptz not null default now()
);
create index if not exists imports_owner on imports (user_id, created_at desc);

create table if not exists import_lines (
  id bigserial primary key,
  import_id uuid not null references imports(id) on delete cascade,
  line int not null,
  task_id uuid,
  type text,
  title text
);

create table if not exists import_errors (
  id bigserial primary key,
  import_id uuid not null references imports(id) on delete cascade,
  line int not null,
  message text not null
);

create table if not exists banners (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id) on delete cascade,
  object_key text not null,
  content_type text not null,
  created_at timestamptz not null default now()
);
create index if not exists banners_party on banners (party_id, created_at desc);
`;
