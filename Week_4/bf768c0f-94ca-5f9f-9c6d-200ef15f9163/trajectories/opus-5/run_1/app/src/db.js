/**
 * PostgreSQL: the only store.  Every fact the club holds lives in these
 * tables and is read from them when it is asked for.
 */

import pg from 'pg';
import crypto from 'node:crypto';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  process.stdout.write(`${JSON.stringify({ level: 'error', msg: 'idle client error', error: error.message })}\n`);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function rows(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

export async function one(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

/** Run a function inside a transaction, handing it a dedicated client. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* the client is going back anyway */ }
    throw error;
  } finally {
    client.release();
  }
}

export function newId() {
  return crypto.randomUUID();
}

/** A stable identifier derived from a seed, so a replay lands on the same row. */
export function derivedId(seed) {
  const hex = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

export const UNIQUE_VIOLATION = '23505';

const SCHEMA = `
create table if not exists members (
  id text primary key,
  username text not null,
  email text not null,
  password_hash text not null,
  rating integer not null default 1200,
  rated_games integer not null default 0,
  avatar_key text not null default 'avatar_01',
  role text not null default 'member' check (role in ('member', 'administrator')),
  view text not null default 'flat' check (view in ('flat', 'deep', 'squares')),
  piece_set_2d text not null default 'Classic',
  piece_set_3d text not null default 'Marble',
  theme text not null default 'Forest',
  sound boolean not null default true,
  avatar_mime text,
  avatar_bytes bytea,
  created_at timestamptz not null default now()
);
create unique index if not exists members_username_key on members (lower(username));
create unique index if not exists members_email_key on members (lower(email));
create index if not exists members_ladder_idx on members (rating desc, rated_games desc, lower(username) asc);

create table if not exists sessions (
  id text primary key,
  member_id text not null references members(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists sessions_member_idx on sessions (member_id);

create table if not exists clubs (
  id text primary key,
  name text not null,
  slug text not null unique,
  private boolean not null default false
);

create table if not exists games (
  id text primary key,
  white_id text references members(id) on delete set null,
  black_id text references members(id) on delete set null,
  club_id text references clubs(id) on delete set null,
  rated boolean not null default false,
  level text,
  fen text not null,
  start_fen text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'finished', 'aborted')),
  result text not null default '*',
  end_reason text,
  opening text,
  draw_offer_by text references members(id) on delete set null,
  takeback_by text references members(id) on delete set null,
  created_at timestamptz not null default now(),
  last_move_at timestamptz not null default now(),
  finished_at timestamptz,
  white_rating_before integer,
  black_rating_before integer,
  white_rated_games_before integer,
  black_rated_games_before integer
);
create index if not exists games_white_idx on games (white_id, finished_at desc);
create index if not exists games_black_idx on games (black_id, finished_at desc);
create index if not exists games_status_idx on games (status, finished_at);
create index if not exists games_club_idx on games (club_id);

create table if not exists moves (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  ply integer not null,
  uci text not null,
  san text not null,
  fen_after text not null,
  announcement text not null,
  created_at timestamptz not null default now(),
  unique (game_id, ply)
);
create index if not exists moves_game_ply_idx on moves (game_id, ply);

create table if not exists chat_messages (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_game_idx on chat_messages (game_id, created_at, id);

create table if not exists challenges (
  id text primary key,
  from_id text not null references members(id) on delete cascade,
  to_id text not null references members(id) on delete cascade,
  club_id text references clubs(id) on delete set null,
  rated boolean not null default true,
  colour text not null check (colour in ('White', 'Black', 'Random')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists challenges_to_idx on challenges (to_id, status);
create index if not exists challenges_from_idx on challenges (from_id, status);

create table if not exists club_memberships (
  club_id text not null references clubs(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  banned boolean not null default false,
  primary key (club_id, member_id)
);

create table if not exists blocks (
  blocker_id text not null references members(id) on delete cascade,
  blocked_id text not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists notifications (
  id text primary key,
  member_id text not null references members(id) on delete cascade,
  kind text not null,
  game_id text references games(id) on delete cascade,
  actor_id text references members(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_member_idx on notifications (member_id, read, created_at desc);

create table if not exists rating_audit (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  admin_id text not null references members(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  rating_before integer not null,
  rating_after integer not null,
  created_at timestamptz not null default now()
);
create index if not exists rating_audit_game_idx on rating_audit (game_id);

create table if not exists login_attempts (
  id text primary key,
  username text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists login_attempts_idx on login_attempts (lower(username), attempted_at desc);
`;

export async function migrate() {
  await pool.query(SCHEMA);
}

export async function storeReadable() {
  const result = await pool.query('select 1 as ok from members limit 1');
  return result.rowCount >= 0;
}
