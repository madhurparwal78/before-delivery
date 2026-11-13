import { pool } from './pool.js';

const STATEMENTS = [
  `create table if not exists app_state (
     key text primary key,
     value text not null
   )`,
  `create table if not exists users (
     id text primary key,
     role text not null,
     name text not null,
     email text not null unique,
     password_hash text not null,
     tz text not null,
     coach_code text unique,
     series_start text,
     start_ctl double precision not null default 0,
     start_atl double precision not null default 0,
     seed_key text unique,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists sessions (
     id text primary key,
     user_id text not null references users(id) on delete cascade,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists one_time_tokens (
     token text primary key,
     user_id text not null references users(id) on delete cascade,
     used boolean not null default false,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists links (
     id text primary key,
     coach_id text not null references users(id) on delete cascade,
     athlete_id text not null references users(id) on delete cascade,
     status text not null,
     expires_at timestamptz not null,
     seed_key text unique,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists thresholds (
     id text primary key,
     athlete_id text not null references users(id) on delete cascade,
     kind text not null,
     value integer not null,
     effective_from text not null,
     unique (athlete_id, kind, effective_from)
   )`,
  `create table if not exists library_items (
     id text primary key,
     owner_id text not null references users(id) on delete cascade,
     name text not null,
     sport text not null,
     steps jsonb not null,
     seed_key text unique,
     created_at timestamptz not null default now(),
     seq bigserial
   )`,
  `create table if not exists plans (
     id text primary key,
     owner_id text not null references users(id) on delete cascade,
     name text not null,
     weeks integer not null,
     entries jsonb not null,
     seed_key text unique,
     created_at timestamptz not null default now(),
     seq bigserial
   )`,
  `create table if not exists workouts (
     id text primary key,
     athlete_id text not null references users(id) on delete cascade,
     kind text not null,
     sport text not null,
     title text not null,
     date text not null,
     start_local text,
     start_utc timestamptz,
     duration_s integer not null,
     steps jsonb,
     planned_tss double precision,
     planned_if double precision,
     tss double precision,
     if_value double precision,
     np_w double precision,
     ns_mps double precision,
     source text not null,
     version integer not null default 1,
     file_name text,
     file_size integer,
     file_sha256 text,
     file_content_type text,
     seed_key text unique,
     created_at timestamptz not null default now(),
     seq bigserial
   )`,
  `create table if not exists comments (
     id text primary key,
     workout_id text not null references workouts(id) on delete cascade,
     author_id text not null references users(id) on delete cascade,
     body text not null,
     seed_key text unique,
     created_at timestamptz not null default now(),
     seq bigserial
   )`,
  `create table if not exists events (
     id text primary key,
     athlete_id text not null references users(id) on delete cascade,
     name text not null,
     date text not null,
     unique (athlete_id, name, date)
   )`,
  `create table if not exists series (
     athlete_id text not null references users(id) on delete cascade,
     date text not null,
     tss double precision not null,
     ctl double precision not null,
     atl double precision not null,
     tsb double precision not null,
     primary key (athlete_id, date)
   )`,
  `create index if not exists workouts_athlete_date on workouts (athlete_id, date)`,
  `create index if not exists comments_workout on comments (workout_id, seq)`,
  `create index if not exists links_coach on links (coach_id)`,
  `create index if not exists links_athlete on links (athlete_id)`,
  `create index if not exists thresholds_athlete on thresholds (athlete_id, kind, effective_from)`,
];

export async function ensureSchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await pool.query(statement);
  }
}

export async function readState(key: string): Promise<string | null> {
  const result = await pool.query<{ value: string }>('select value from app_state where key = $1', [key]);
  return result.rows[0]?.value ?? null;
}

export async function writeState(key: string, value: string): Promise<void> {
  await pool.query(
    `insert into app_state (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, value],
  );
}

export async function clearAllRecords(): Promise<void> {
  await pool.query('truncate series, comments, workouts, events, thresholds, library_items, plans, links, one_time_tokens, sessions, users');
}
