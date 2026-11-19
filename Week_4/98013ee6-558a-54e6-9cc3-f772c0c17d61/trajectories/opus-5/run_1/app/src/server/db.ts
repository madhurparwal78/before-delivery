import pg from 'pg';
import { env } from './env.js';

pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export type Row = object;

const pgPool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30000,
});

export interface Queryable {
  query<T extends Row = Row>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

function wrap(runner: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []) {
      const result = await runner.query<T & pg.QueryResultRow>(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount };
    },
  };
}

export const pool: Queryable = wrap(pgPool);

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export async function one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function tx<T>(run: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pgPool.connect();
  try {
    await client.query('begin');
    const result = await run(wrap(client));
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists business_clock (
  id int primary key check (id = 1),
  base_instant timestamptz not null,
  base_real timestamptz not null
);

create table if not exists app_flags (
  key text primary key,
  value text not null
);

create table if not exists users (
  id bigserial primary key,
  email text not null,
  email_lower text not null unique,
  password_hash text not null,
  name text not null,
  handle text not null unique,
  created_at timestamptz not null
);

create table if not exists signup_codes (
  email_lower text primary key,
  email text not null,
  name text not null,
  handle text not null,
  password_hash text not null,
  code text not null,
  created_at timestamptz not null
);

create table if not exists sessions (
  token text primary key,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null
);

create table if not exists images (
  id bigserial primary key,
  sha256 text not null,
  width int not null,
  height int not null,
  format text not null,
  variants int[] not null,
  purged boolean not null default false,
  created_at timestamptz not null
);

create table if not exists boards (
  id bigserial primary key,
  owner_id bigint not null references users(id) on delete cascade,
  name text not null,
  name_lower text not null,
  visibility text not null,
  cover_pin_id bigint,
  seq int not null default 0,
  created_at timestamptz not null,
  last_saved_at timestamptz,
  deleted_at timestamptz
);
create unique index if not exists boards_owner_name_key on boards (owner_id, name_lower) where deleted_at is null;

create table if not exists sections (
  id bigserial primary key,
  board_id bigint not null references boards (id) on delete cascade,
  name text not null,
  name_lower text not null,
  position int not null,
  deleted_at timestamptz
);
create unique index if not exists sections_board_name_key on sections (board_id, name_lower) where deleted_at is null;

create table if not exists pins (
  id bigserial primary key,
  owner_id bigint not null references users (id) on delete cascade,
  board_id bigint not null references boards (id) on delete cascade,
  section_id bigint references sections (id),
  position int not null,
  title text not null,
  description text not null,
  alt text not null,
  source text,
  image_id bigint not null references images (id),
  root_pin_id bigint references pins (id),
  state text not null,
  version int not null default 1,
  search_text text not null,
  created_at timestamptz not null,
  deleted_at timestamptz,
  delete_op_id bigint
);
create index if not exists pins_board_idx on pins (board_id) where state = 'live';
create index if not exists pins_owner_idx on pins (owner_id) where state = 'live';
create index if not exists pins_root_idx on pins (root_pin_id) where state = 'live';

create table if not exists pin_tags (
  pin_id bigint not null references pins (id) on delete cascade,
  tag text not null,
  ord int not null,
  primary key (pin_id, tag)
);
create index if not exists pin_tags_tag_idx on pin_tags (tag);

create table if not exists follows_users (
  follower_id bigint not null references users (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  created_at timestamptz not null,
  primary key (follower_id, user_id)
);

create table if not exists follows_boards (
  follower_id bigint not null references users (id) on delete cascade,
  board_id bigint not null references boards (id) on delete cascade,
  created_at timestamptz not null,
  primary key (follower_id, board_id)
);

create table if not exists board_members (
  board_id bigint not null references boards (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  role text not null,
  created_at timestamptz not null,
  primary key (board_id, user_id)
);

create table if not exists invites (
  id bigserial primary key,
  board_id bigint not null references boards (id) on delete cascade,
  inviter_id bigint not null references users (id) on delete cascade,
  email text not null,
  email_lower text not null,
  role text not null,
  token text not null unique,
  status text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists comments (
  id bigserial primary key,
  pin_id bigint not null references pins (id) on delete cascade,
  author_id bigint not null references users (id) on delete cascade,
  parent_id bigint references comments (id) on delete cascade,
  text text not null,
  deleted boolean not null default false,
  created_at timestamptz not null
);
create index if not exists comments_pin_idx on comments (pin_id);

create table if not exists reactions (
  pin_id bigint not null references pins (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  type text not null,
  created_at timestamptz not null,
  primary key (pin_id, user_id)
);

create table if not exists operations (
  id bigserial primary key,
  actor_id bigint not null references users (id) on delete cascade,
  kind text not null,
  target_board_id bigint,
  count int not null,
  deadline timestamptz not null,
  status text not null,
  created_at timestamptz not null,
  payload jsonb not null
);
create index if not exists operations_open_idx on operations (deadline) where status = 'open';

create table if not exists board_viewers (
  conn_id text primary key,
  instance_id text not null,
  board_id bigint not null,
  user_id bigint not null references users (id) on delete cascade,
  started_at timestamptz not null
);
create index if not exists board_viewers_board_idx on board_viewers (board_id);
`;

export async function applySchema(): Promise<void> {
  await pgPool.query(SCHEMA);
}

export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      await pgPool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
