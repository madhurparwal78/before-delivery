import pg from 'pg';
import { config } from './config';

const SCHEMA = `
create table if not exists players (
  id uuid primary key,
  display_name text not null,
  skip_filled boolean not null default true,
  jump_next_clue boolean not null default false,
  autocheck boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists puzzles (
  id uuid primary key,
  title text not null,
  author text not null,
  cols integer not null,
  rows integer not null,
  source text not null,
  fixture text unique,
  sha256 text,
  owner_id uuid references players(id),
  blocks jsonb not null,
  numbers jsonb not null,
  clues jsonb not null,
  solution jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id uuid primary key,
  puzzle_id uuid not null references puzzles(id),
  host_player_id uuid not null references players(id),
  code text,
  link_state text not null,
  status text not null,
  mode text not null,
  race_state text,
  seq integer not null default 0,
  checked_count integer not null default 0,
  solved_at timestamptz,
  solved_seq integer,
  record_ready boolean not null default false,
  initial_squares jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists game_codes (
  code text primary key,
  game_id uuid not null references games(id),
  state text not null
);

create table if not exists game_players (
  game_id uuid not null references games(id),
  player_id uuid not null references players(id),
  colour text not null,
  host boolean not null,
  seat integer not null,
  present boolean not null default false,
  team integer,
  score integer not null default 0,
  joined_code text,
  joined_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table if not exists squares (
  game_id uuid not null references games(id),
  team integer not null,
  row integer not null,
  col integer not null,
  value text not null default '',
  pencil boolean not null default false,
  state text not null default 'empty',
  owner text,
  primary key (game_id, team, row, col)
);

create table if not exists race_claims (
  game_id uuid not null references games(id),
  row integer not null,
  col integer not null,
  team integer not null,
  player_id uuid not null references players(id),
  owner text not null,
  primary key (game_id, row, col)
);

create table if not exists ops (
  game_id uuid not null references games(id),
  seq integer not null,
  type text not null,
  by uuid not null references players(id),
  at timestamptz not null,
  client_op_id text,
  team integer,
  op jsonb not null,
  message jsonb not null,
  request jsonb not null,
  primary key (game_id, seq)
);

create unique index if not exists ops_client_op_id
  on ops (game_id, by, client_op_id) where client_op_id is not null;

create table if not exists timer_segments (
  game_id uuid not null references games(id),
  idx integer not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  primary key (game_id, idx)
);

create table if not exists history_entries (
  game_id uuid not null references games(id),
  player_id uuid not null references players(id),
  created_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
`;

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function transaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Waits for Postgres, retrying every second, then applies the schema. */
export async function connectAndMigrate(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      break;
    } catch {
      await delay(1000);
    }
  }
  await pool.query(SCHEMA);
}
