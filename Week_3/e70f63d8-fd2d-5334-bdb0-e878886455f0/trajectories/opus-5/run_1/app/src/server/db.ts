import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function one<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const value = await run(client);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists teams (
  id uuid primary key,
  organiser_id uuid not null references users(id) on delete cascade,
  name text not null,
  logo_key text,
  logo_type text,
  logo_uploads integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists players (
  id uuid primary key,
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  short_name text not null,
  position integer not null
);
create table if not exists tournaments (
  id uuid primary key,
  organiser_id uuid not null references users(id) on delete cascade,
  name text not null,
  overs integer not null,
  players_per_side integer not null,
  super_over boolean not null,
  created_at timestamptz not null default now()
);
create table if not exists groups (
  id uuid primary key,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  position integer not null
);
create table if not exists group_teams (
  group_id uuid not null references groups(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  position integer not null,
  primary key (group_id, team_id)
);
create table if not exists matches (
  id uuid primary key,
  organiser_id uuid not null references users(id) on delete cascade,
  home_team_id uuid not null references teams(id) on delete cascade,
  away_team_id uuid not null references teams(id) on delete cascade,
  overs integer not null,
  players_per_side integer not null,
  super_over boolean not null,
  batting_first uuid not null references teams(id) on delete cascade,
  tournament_id uuid references tournaments(id) on delete set null,
  viewer_code text not null,
  viewer_link boolean not null default true,
  played_on date,
  summary jsonb,
  created_at timestamptz not null default now()
);
create table if not exists match_xi (
  match_id uuid not null references matches(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  position integer not null,
  primary key (match_id, player_id)
);
create table if not exists match_scorers (
  match_id uuid not null references matches(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (match_id, user_id)
);
create table if not exists innings (
  id uuid primary key,
  match_id uuid not null references matches(id) on delete cascade,
  idx integer not null,
  key text not null,
  striker uuid not null references players(id) on delete cascade,
  non_striker uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists ball_events (
  id bigserial primary key,
  innings_id uuid not null references innings(id) on delete cascade,
  ord integer not null,
  type text not null,
  data jsonb not null
);
create table if not exists invitations (
  id uuid primary key,
  match_id uuid not null references matches(id) on delete cascade,
  organiser_id uuid not null references users(id) on delete cascade,
  email text not null,
  token text not null unique,
  sent_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references users(id) on delete set null
);
create unique index if not exists innings_match_idx on innings (match_id, idx);
create unique index if not exists ball_events_innings_ord on ball_events (innings_id, ord);
create unique index if not exists players_team_short on players (team_id, short_name);
create unique index if not exists matches_viewer_code on matches (viewer_code);
create index if not exists ball_events_innings on ball_events (innings_id, ord);
create index if not exists matches_tournament on matches (tournament_id);
create index if not exists invitations_organiser on invitations (organiser_id, sent_at);
`;

export async function ensureSchema(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function postgresUp(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
