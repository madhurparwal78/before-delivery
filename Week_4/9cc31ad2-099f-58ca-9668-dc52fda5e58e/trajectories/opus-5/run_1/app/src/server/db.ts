import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export interface Queryable {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export const db: Queryable = {
  query: <Row extends QueryResultRow>(text: string, values?: unknown[]) =>
    pool.query<Row>(text, values).then((result) => ({ rows: result.rows })),
};

export async function one<Row extends QueryResultRow>(
  queryable: Queryable,
  text: string,
  values?: unknown[],
): Promise<Row | null> {
  const { rows } = await queryable.query<Row>(text, values);
  return rows[0] ?? null;
}

const SCHEMA = `
create table if not exists accounts (
  account text primary key
);

create table if not exists players (
  player_id uuid primary key,
  name text not null,
  guest boolean not null default true,
  email text,
  units text not null default 'kmh',
  selected_car_id text not null,
  trophy boolean not null default false,
  retired boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists players_email_unique on players (lower(email)) where email is not null;

create table if not exists sessions (
  session_id uuid primary key,
  player_id uuid not null references players(player_id),
  created_at timestamptz not null default now()
);

create table if not exists owned_cars (
  player_id uuid not null references players(player_id),
  car_id text not null,
  stage_engine integer not null default 0,
  stage_tires integer not null default 0,
  stage_brakes integer not null default 0,
  stage_suspension integer not null default 0,
  paid_engine integer not null default 0,
  paid_tires integer not null default 0,
  paid_brakes integer not null default 0,
  paid_suspension integer not null default 0,
  primary key (player_id, car_id)
);

create table if not exists purchases (
  purchase_id uuid primary key,
  player_id uuid not null references players(player_id),
  car_id text not null,
  system text not null,
  stage integer not null,
  price integer not null,
  layout_id text not null,
  old_lap_ms integer not null,
  new_lap_ms integer not null,
  delta_ms integer not null,
  old_sectors_ms integer[] not null,
  new_sectors_ms integer[] not null,
  sector_deltas_ms integer[] not null,
  seq bigserial,
  created_at timestamptz not null default now()
);
create index if not exists purchases_player_car on purchases (player_id, car_id, seq desc);

create table if not exists ledger_movements (
  movement_id uuid primary key,
  player_id uuid not null references players(player_id),
  kind text not null,
  run_id uuid,
  seq bigserial,
  created_at timestamptz not null default now()
);
create index if not exists ledger_movements_player on ledger_movements (player_id, seq desc);

create table if not exists ledger_entries (
  entry_id bigserial primary key,
  movement_id uuid not null references ledger_movements(movement_id),
  account text not null,
  amount bigint not null
);
create index if not exists ledger_entries_account on ledger_entries (account);
create index if not exists ledger_entries_movement on ledger_entries (movement_id);

create table if not exists idempotency_records (
  player_id uuid not null references players(player_id),
  key text not null,
  body_hash text not null,
  status integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (player_id, key)
);

create table if not exists runs (
  run_id uuid primary key,
  player_id uuid not null references players(player_id),
  layout_id text not null,
  mode text not null,
  car_id text not null,
  event_id text,
  laps integer not null,
  step_limit integer not null,
  loaner boolean not null default false,
  seed text not null,
  status text not null,
  reason text,
  car_stats jsonb not null,
  car_stages jsonb not null,
  replay_bytes bytea,
  replay_sha256 text,
  replay_stored boolean not null default false,
  lap_results jsonb,
  race_ms integer,
  best_lap_ms integer,
  drift_score integer,
  coins_collected integer,
  position integer,
  clean boolean,
  payout integer,
  top_speed_mps double precision,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  verified_at timestamptz
);
create index if not exists runs_player on runs (player_id, created_at desc);
create index if not exists runs_held on runs (status) where status = 'held';

create table if not exists board_rows (
  layout_id text not null,
  mode text not null,
  class text not null,
  player_id uuid not null references players(player_id),
  run_id uuid not null references runs(run_id),
  car_id text not null,
  value bigint not null,
  top_speed_mps double precision not null,
  verified_at timestamptz not null default now(),
  seq bigserial,
  primary key (layout_id, mode, class, player_id)
);

create table if not exists event_points (
  player_id uuid not null references players(player_id),
  event_id text not null,
  points integer not null,
  primary key (player_id, event_id)
);

create table if not exists league_state (
  player_id uuid not null references players(player_id),
  league_id text not null,
  completed_at timestamptz not null default now(),
  primary key (player_id, league_id)
);

create table if not exists signin_tokens (
  token text primary key,
  email text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists lobbies (
  lobby_id uuid primary key,
  host_id uuid not null references players(player_id),
  state text not null,
  ai_count integer not null,
  created_at timestamptz not null default now()
);

create table if not exists lobby_players (
  lobby_id uuid not null references lobbies(lobby_id),
  player_id uuid not null references players(player_id),
  ready boolean not null default false,
  connection text not null default 'connected',
  joined_seq bigserial,
  primary key (lobby_id, player_id)
);

insert into accounts (account)
values ('house:grants'), ('house:pickups'), ('house:results'), ('house:shop'), ('house:refits')
on conflict do nothing;
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      return;
    } catch (error) {
      console.error('database not ready, retrying', (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * The one place per-player balance, stage and championship changes are serialised.
 * Every change that touches a player's wallet, garage or standing runs inside this.
 */
export async function withPlayerLock<T>(
  playerId: string,
  work: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [playerId]);
    const tx: Queryable = {
      query: <Row extends QueryResultRow>(text: string, values?: unknown[]) =>
        client.query<Row>(text, values).then((result) => ({ rows: result.rows })),
    };
    const result = await work(tx);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
