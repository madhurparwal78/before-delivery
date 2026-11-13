import * as pg from 'pg';
import { GAMEWEEK_COUNT } from '../shared/domain';
import { CLUBS, PLAYERS } from './seed';

export async function seedDatabase(pool: pg.Pool): Promise<void> {
  await seedDatabaseStatements(pool);
  await seedCatalogue(pool);
  await seedGameweeks(pool);
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS managers (
  id text PRIMARY KEY,
  pocketbase_id text NOT NULL UNIQUE,
  team_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  manager_id text NOT NULL REFERENCES managers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gameweeks (
  number integer PRIMARY KEY,
  status text NOT NULL,
  deadline timestamptz,
  locked_at timestamptz
);

CREATE TABLE IF NOT EXISTS fixtures (
  id text PRIMARY KEY,
  gameweek integer NOT NULL REFERENCES gameweeks(number),
  home text NOT NULL,
  away text NOT NULL,
  kickoff timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS squads (
  manager_id text PRIMARY KEY REFERENCES managers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS squad_players (
  manager_id text NOT NULL REFERENCES squads(manager_id),
  player_id text NOT NULL,
  purchase_price_tenths integer NOT NULL,
  PRIMARY KEY (manager_id, player_id)
);

CREATE TABLE IF NOT EXISTS picks (
  manager_id text NOT NULL REFERENCES squads(manager_id),
  gameweek integer NOT NULL,
  starting text[] NOT NULL,
  bench text[] NOT NULL,
  captain text,
  vice_captain text,
  PRIMARY KEY (manager_id, gameweek)
);

CREATE TABLE IF NOT EXISTS locked_teams (
  manager_id text NOT NULL REFERENCES squads(manager_id),
  gameweek integer NOT NULL,
  starting text[] NOT NULL,
  bench text[] NOT NULL,
  captain text,
  vice_captain text,
  chip text,
  bank_tenths integer NOT NULL,
  squad jsonb NOT NULL,
  locked_at timestamptz NOT NULL,
  receipt text NOT NULL DEFAULT 'pending',
  PRIMARY KEY (manager_id, gameweek)
);

CREATE TABLE IF NOT EXISTS chips (
  id text PRIMARY KEY,
  manager_id text NOT NULL REFERENCES squads(manager_id),
  gameweek integer NOT NULL,
  chip text NOT NULL,
  cancelled boolean NOT NULL DEFAULT false,
  played_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manager_id, gameweek, chip)
);

CREATE TABLE IF NOT EXISTS transfers (
  id text PRIMARY KEY,
  manager_id text NOT NULL REFERENCES squads(manager_id),
  gameweek integer NOT NULL,
  out_player text NOT NULL,
  in_player text NOT NULL,
  sell_price_tenths integer NOT NULL,
  price_tenths integer NOT NULL,
  free_hit boolean NOT NULL DEFAULT false,
  made_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  manager_id text NOT NULL REFERENCES squads(manager_id),
  kind text NOT NULL,
  amount_tenths integer NOT NULL,
  player_id text,
  transfer_id text,
  reverses text,
  gameweek integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hits (
  manager_id text NOT NULL REFERENCES squads(manager_id),
  gameweek integer NOT NULL,
  hit_points integer NOT NULL DEFAULT 0,
  PRIMARY KEY (manager_id, gameweek)
);

CREATE TABLE IF NOT EXISTS squad_meta (
  manager_id text PRIMARY KEY REFERENCES squads(manager_id),
  bank_tenths integer NOT NULL,
  free_transfers integer NOT NULL DEFAULT 1,
  transfers_made integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drafts (
  manager_id text NOT NULL REFERENCES squads(manager_id),
  gameweek integer NOT NULL,
  state text NOT NULL DEFAULT 'clean',
  out_players text[] NOT NULL DEFAULT '{}',
  in_players text[] NOT NULL DEFAULT '{}',
  refusal jsonb,
  PRIMARY KEY (manager_id, gameweek)
);

CREATE TABLE IF NOT EXISTS events (
  event_id text PRIMARY KEY,
  gameweek integer NOT NULL,
  fixture_id text NOT NULL,
  player_id text NOT NULL,
  type text NOT NULL,
  value integer,
  points_delta integer NOT NULL,
  voided boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS free_hit_states (
  manager_id text NOT NULL REFERENCES squads(manager_id),
  gameweek integer NOT NULL,
  squad jsonb NOT NULL,
  picks jsonb NOT NULL,
  bank_tenths integer NOT NULL,
  PRIMARY KEY (manager_id, gameweek)
);

CREATE TABLE IF NOT EXISTS price_runs (
  run_date date PRIMARY KEY,
  applied jsonb NOT NULL,
  skipped jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS price_moves_log (
  id text PRIMARY KEY,
  player_id text NOT NULL,
  run_date date NOT NULL,
  delta_tenths integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leagues (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  admin_manager_id text NOT NULL REFERENCES managers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS league_members (
  league_id text NOT NULL REFERENCES leagues(id),
  manager_id text NOT NULL REFERENCES managers(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, manager_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  manager_id text NOT NULL,
  key text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (manager_id, key)
);

CREATE TABLE IF NOT EXISTS notice_outbox (
  id text NOT NULL,
  pocketbase_user_id text NOT NULL,
  manager_id text NOT NULL,
  kind text NOT NULL,
  gameweek integer NOT NULL,
  message text NOT NULL,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, pocketbase_user_id)
);

CREATE INDEX IF NOT EXISTS notice_outbox_undelivered ON notice_outbox (delivered_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS operator_seed (
  email text PRIMARY KEY
);


CREATE TABLE IF NOT EXISTS gameweek_scores (
  manager_id text NOT NULL REFERENCES squads(manager_id),
  gameweek integer NOT NULL,
  points integer NOT NULL,
  hit_points integer NOT NULL DEFAULT 0,
  net_points integer NOT NULL,
  captain text,
  vice_captain text,
  PRIMARY KEY (manager_id, gameweek)
);

CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  name text NOT NULL,
  club text NOT NULL,
  position text NOT NULL,
  price_tenths integer NOT NULL
);

CREATE TABLE IF NOT EXISTS clubs (
  code text PRIMARY KEY,
  name text NOT NULL
);
`;

async function seedDatabaseStatements(pool: pg.Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

async function seedCatalogue(pool: pg.Pool): Promise<void> {
  for (const club of CLUBS) {
    await pool.query(
      `INSERT INTO clubs (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
      [club.code, club.name],
    );
  }
  for (const player of PLAYERS) {
    await pool.query(
      `INSERT INTO players (id, name, club, position, price_tenths) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [player.id, player.name, player.club, player.position, player.price_tenths],
    );
  }
}

async function seedGameweeks(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ number: number }>(`SELECT number FROM gameweeks`);
  if (rows.length >= GAMEWEEK_COUNT) return;
  for (let gw = 1; gw <= GAMEWEEK_COUNT; gw += 1) {
    const status = gw === 1 ? 'open' : 'upcoming';
    await pool.query(
      `INSERT INTO gameweeks (number, status) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING`,
      [gw, status],
    );
  }
}
