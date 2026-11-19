import { Pool, type QueryResultRow } from "pg";
import { config } from "./config";

const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

/** Applies the schema idempotently on every serve (DP: services). */
export async function initDb(): Promise<void> {
  await withRetry(async () => {
    await pool.query(`select 1`);
  }, "Postgres");
  await pool.query(SCHEMA_SQL);
}

async function withRetry(fn: () => Promise<void>, what: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { await fn(); return; } catch (e) {
      if (Date.now() > deadline) {
        console.error(`${what} unreachable at boot`, e);
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export interface Db {
  query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
}

export function dbOf(run: (sql: string, params: unknown[]) => Promise<{ rows: QueryResultRow[] }>): Db {
  return {
    query: async <T extends QueryResultRow>(sql: string, params: unknown[] = []) =>
      (await run(sql, params)).rows as T[],
    queryOne: async <T extends QueryResultRow>(sql: string, params: unknown[] = []) =>
      ((await run(sql, params)).rows[0] ?? null) as T | null,
  };
}

export const poolDb: Db = dbOf((sql, params) => pool.query(sql, params as never[]));

/** Runs fn in one transaction; bulk operations, undo and moves each use one (engineering standards). */
export async function withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Db = dbOf((sql, params) => client.query(sql, params as never[]));
  try {
    await client.query("begin");
    const result = await fn(tx);
    await client.query("commit");
    return result;
  } catch (e) {
    try { await client.query("rollback"); } catch { /* connection already broken */ }
    throw e;
  } finally {
    client.release();
  }
}

const SCHEMA_SQL = `
create table if not exists meta (key text primary key, value text not null);

create table if not exists users (
  id bigint generated always as identity primary key,
  email text not null,
  password_hash text not null,
  name text not null,
  handle text not null unique,
  created_at timestamptz not null
);
create unique index if not exists users_email_uk on users (lower(email));

create table if not exists signup_codes (
  id bigint generated always as identity primary key,
  email text not null,
  code text not null,
  created_at timestamptz not null
);
create index if not exists signup_codes_email_idx on signup_codes (email, created_at desc);

create table if not exists pending_accounts (
  email text primary key,
  password_hash text not null,
  name text not null,
  handle text not null,
  created_at timestamptz not null
);

create table if not exists sessions (
  token text primary key,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null
);

create table if not exists images (
  id bigint generated always as identity primary key,
  width integer not null,
  height integer not null,
  sha256 text not null,
  format text not null check (format in ('png','jpeg')),
  created_at timestamptz not null
);
create index if not exists images_sha_idx on images (sha256);

create table if not exists boards (
  id bigint generated always as identity primary key,
  owner_id bigint not null references users(id) on delete cascade,
  name text not null,
  name_key text not null,
  visibility text not null check (visibility in ('public','secret')),
  seq bigint not null default 0,
  cover_pin_id bigint,
  last_saved_at timestamptz,
  created_at timestamptz not null
);
create index if not exists boards_owner_idx on boards (owner_id);
create unique index if not exists boards_owner_name_uk on boards (owner_id, name_key);

create table if not exists sections (
  id bigint generated always as identity primary key,
  board_id bigint not null references boards(id) on delete cascade,
  name text not null,
  name_key text not null,
  position integer not null,
  created_at timestamptz not null
);
create unique index if not exists sections_board_name_uk on sections (board_id, name_key);

create table if not exists pins (
  id bigint generated always as identity primary key,
  owner_id bigint not null references users(id) on delete cascade,
  board_id bigint not null references boards(id) on delete cascade,
  section_id bigint references sections(id) on delete set null,
  image_id bigint not null references images(id),
  root_id bigint,
  version integer not null default 1,
  title text not null,
  description text not null default '',
  alt text not null,
  source text,
  source_host text,
  tags text[] not null default '{}',
  position integer not null,
  status text not null check (status in ('draft','live','deleted','gone')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists pins_board_idx on pins (board_id, section_id, position);
create index if not exists pins_root_idx on pins (root_id) where status = 'live';
create index if not exists pins_owner_idx on pins (owner_id, created_at desc);

create table if not exists follows_users (
  follower_id bigint not null references users(id) on delete cascade,
  target_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null,
  primary key (follower_id, target_id)
);
create table if not exists follows_boards (
  follower_id bigint not null references users(id) on delete cascade,
  board_id bigint not null references boards(id) on delete cascade,
  created_at timestamptz not null,
  primary key (follower_id, board_id)
);

create table if not exists comments (
  id bigint generated always as identity primary key,
  pin_id bigint not null references pins(id) on delete cascade,
  author_id bigint not null references users(id) on delete cascade,
  parent_id bigint references comments(id) on delete cascade,
  text text,
  deleted boolean not null default false,
  created_at timestamptz not null
);
create index if not exists comments_pin_idx on comments (pin_id, created_at);

create table if not exists reactions (
  pin_id bigint not null references pins(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  type text not null check (type in ('love','idea','wow','thanks')),
  created_at timestamptz not null,
  primary key (pin_id, user_id)
);

create table if not exists board_members (
  board_id bigint not null references boards(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  created_at timestamptz not null,
  primary key (board_id, user_id)
);

create table if not exists invites (
  id bigint generated always as identity primary key,
  board_id bigint not null references boards(id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor','viewer')),
  token text not null unique,
  status text not null check (status in ('pending','accepted','revoked')),
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  accepted_at timestamptz
);
create index if not exists invites_board_email_idx on invites (board_id, lower(email));

create table if not exists operations (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  kind text not null check (kind in ('move','copy','delete')),
  board_id bigint not null,
  target_board_id bigint,
  target_section_id bigint,
  count integer not null,
  status text not null check (status in ('open','undone','expired')),
  payload jsonb not null,
  deadline timestamptz not null,
  created_at timestamptz not null
);
create index if not exists operations_open_idx on operations (status, deadline);
`;
